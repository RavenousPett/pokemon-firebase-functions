/**
 * Copyright 2023 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
"use strict";

import {onRequest} from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import {initializeApp} from "firebase-admin/app";

initializeApp();

// Data Connect GraphQL endpoint
// Use emulator in development, production endpoint otherwise
const DATA_CONNECT_URL =
  process.env.DATA_CONNECT_URL ||
  "https://us-east4-pokemon-football.dataconnect.firebase.googleapis.com/graphql";

// Tool definitions for Claude
const tools: Anthropic.Tool[] = [
  {
    name: "list_matches",
    description:
      "Get all Pokemon football matches with their goals and throw-ins counts. " +
      "Use this to see all matches or get an overview of match statistics.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_match",
    description:
      "Get details of a specific match including all players. " +
      "Use this when you need information about a particular match by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The match UUID",
        },
      },
      required: ["id"],
    },
  },
];

// GraphQL query helper
async function queryDataConnect(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<unknown> {
  const response = await fetch(DATA_CONNECT_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({query, variables}),
  });
  return response.json();
}

// Handle tool calls
async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
  case "list_matches":
    return queryDataConnect(`
        query ListMatches {
          matches(orderBy: { createdAt: DESC }) {
            id
            name
            goals
            throwIns
            createdAt
          }
        }
      `);
  case "get_match":
    return queryDataConnect(
      `
        query GetMatch($id: UUID!) {
          match(id: $id) {
            id
            name
            goals
            throwIns
            players_on_match {
              id
              name
              pokemonType
            }
          }
        }
      `,
      {id: toolInput.id}
    );
  default:
    return {error: `Unknown tool: ${toolName}`};
  }
}

// Main function to call Claude with tools
async function callClaudeWithTools(
  anthropicClient: Anthropic,
  userMessage: string
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {role: "user", content: userMessage},
  ];

  // Agentic loop - keep processing until Claude is done
  while (true) {
    const response = await anthropicClient.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system:
        "You are a helpful assistant for a Pokemon Football app called 'Grass vs Electric Derby'. " +
        "You can query the database to answer questions about matches, players, goals, and throw-ins. " +
        "When users ask about match data, use the available tools to fetch real information. " +
        "Be friendly and informative in your responses.",
      tools,
      messages,
    });

    // Check if Claude wants to use tools
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      // Execute all tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await handleToolCall(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Add assistant response and tool results to messages
      messages.push({role: "assistant", content: response.content});
      messages.push({role: "user", content: toolResults});
    } else {
      // Claude is done - extract text response
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      return textBlock?.text || "No response generated.";
    }
  }
}

export const calmMeDown = onRequest(
  {secrets: ["ANTHROPIC_API_KEY"], cors: true},
  async (req, res) => {
    const anthropicClient = new Anthropic();
    const userInputText = String(req.body?.userInputText || "");

    if (!userInputText.trim()) {
      res.set("Content-Type", "text/plain");
      res.send("Please enter a message.");
      return;
    }

    try {
      const responseText = await callClaudeWithTools(
        anthropicClient,
        userInputText
      );

      res.set("Content-Type", "text/plain");
      res.send(responseText);
    } catch (error) {
      console.error("Error calling Claude:", error);
      res.status(500).set("Content-Type", "text/plain");
      res.send("Sorry, something went wrong. Please try again.");
    }
  }
);
