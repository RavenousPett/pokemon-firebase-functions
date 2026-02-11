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
import {Response} from "express";
import {initializeApp} from "firebase-admin/app";
import {getDataConnect} from "firebase-admin/data-connect";

const app = initializeApp();

// Initialize Data Connect with your service config
const dataConnect = getDataConnect({
  serviceId: "pokemon-football",
  location: "us-east4",
}, app);

// Tool definitions for Claude
const tools: Anthropic.Tool[] = [
  {
    name: "list_matches",
    description:
      "Get all Pokemon football matches with their goals and " +
      "throw-ins counts. Use this to see all matches or get an " +
      "overview of match statistics.",
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

/**
 * Makes a GraphQL query to Firebase Data Connect using Admin SDK.
 * @param {string} query - The GraphQL query string.
 * @param {Record<string, unknown>} variables - Query variables.
 * @return {Promise<unknown>} The query result.
 */
async function queryDataConnect(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<unknown> {
  const result = await dataConnect.executeGraphql(query, {
    variables,
    operationName: undefined,
  });
  return result.data;
}

/**
 * Handles a tool call from Claude by executing the appropriate query.
 * @param {string} toolName - The name of the tool to execute.
 * @param {Record<string, unknown>} toolInput - The tool input parameters.
 * @return {Promise<unknown>} The tool execution result.
 */
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
            matchPlayers_on_match {
              player {
                id
                name
                pokemonType
              }
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

const SYSTEM_PROMPT =
  "You are a helpful assistant for a Pokemon Football app " +
  "called 'Grass vs Electric Derby'. You can query the database to " +
  "answer questions about matches, players, goals, and throw-ins. " +
  "When users ask about match data, use the available tools to fetch " +
  "real information. Be friendly and informative in your responses." +
  "\n\nIMPORTANT CONTEXT: The current match ID is " +
  "bb785dd0-a9b2-48fb-bd01-f9b8c6eaa0a9. " +
  "When the user asks about 'the match', 'this match', 'current match', " +
  "or similar, use this ID without asking for clarification.";

/**
 * Calls Claude with tools and handles the agentic loop.
 * Streams text deltas directly to the HTTP response.
 * @param {Anthropic} anthropicClient - The Anthropic client instance.
 * @param {string} userMessage - The user's message.
 * @param {Response} res - Express response to stream text into.
 * @return {Promise<void>}
 */
async function callClaudeWithTools(
  anthropicClient: Anthropic,
  userMessage: string,
  res: Response
): Promise<void> {
  const messages: Anthropic.MessageParam[] = [
    {role: "user", content: userMessage},
  ];

  // Agentic loop - keep processing until Claude is done
  let continueLoop = true;
  while (continueLoop) {
    const stream = anthropicClient.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    // Stream text deltas to the client as they arrive
    stream.on("text", (delta) => {
      res.write(delta);
    });

    const response = await stream.finalMessage();

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
      // Claude is done - streaming already happened via the text event
      continueLoop = false;
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
      // Set streaming headers before writing any chunks
      res.set({
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });

      await callClaudeWithTools(anthropicClient, userInputText, res);
      res.end();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : "";
      console.error("Error calling Claude:", errMsg, errStack);
      if (res.headersSent) {
        res.end();
      } else {
        res.status(500).set("Content-Type", "text/plain");
        res.send(`Error: ${errMsg}`);
      }
    }
  }
);
