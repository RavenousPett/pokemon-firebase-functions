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
    name: "get_all_match_data",
    description:
      "Get ALL matches with full detail including squad appearances " +
      "and match events. This is the most comprehensive query — use it " +
      "when you need to analyse patterns across matches, find top scorers, " +
      "compare formations, or answer broad questions about the team.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_matches",
    description:
      "Get a quick overview of all matches with scores, results, " +
      "formations, and venues. Does NOT include events or squad details. " +
      "Use for a summary view.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_match",
    description:
      "Get full detail for a specific match including squad " +
      "appearances and all match events in minute order.",
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
  {
    name: "list_players",
    description:
      "Get all players in the squad with their jersey number, " +
      "position, and Pokemon type.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_player",
    description:
      "Get a specific player's full profile including all their " +
      "match appearances and events across all matches.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The player UUID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_events_by_type",
    description:
      "Get all match events of a specific type across all matches. " +
      "Valid types: GOAL_SCORED, GOAL_CONCEDED, THROW_IN, CORNER_TAKEN, " +
      "CORNER_CONCEDED, YELLOW_CARD, RED_CARD, FOUL_COMMITTED, " +
      "FOUL_SUFFERED, SUBSTITUTION_ON, SUBSTITUTION_OFF.",
    input_schema: {
      type: "object" as const,
      properties: {
        eventType: {
          type: "string",
          description: "The event type enum value",
        },
      },
      required: ["eventType"],
    },
  },
  {
    name: "get_player_events",
    description:
      "Get all match events for a specific player across all matches.",
    input_schema: {
      type: "object" as const,
      properties: {
        playerId: {
          type: "string",
          description: "The player UUID",
        },
      },
      required: ["playerId"],
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
  case "get_all_match_data":
    return queryDataConnect(`
        query GetAllMatchData {
          matches(orderBy: { date: DESC }) {
            id date kickoffTime opposition venueName venueCity
            isHome formation goalsScored goalsConceded result
            halfTimeGoalsScored halfTimeGoalsConceded notes
            matchAppearances_on_match {
              isStarter minutesPlayed
              player { id name jerseyNumber position pokemonType }
            }
            matchEvents_on_match(orderBy: { minute: ASC }) {
              id eventType minute note
              player { id name }
              secondaryPlayer { id name }
            }
          }
        }
      `);
  case "list_matches":
    return queryDataConnect(`
        query ListMatches {
          matches(orderBy: { date: DESC }) {
            id date kickoffTime opposition venueName venueCity
            isHome formation goalsScored goalsConceded result
            halfTimeGoalsScored halfTimeGoalsConceded notes
          }
        }
      `);
  case "get_match":
    return queryDataConnect(
      `
        query GetMatch($id: UUID!) {
          match(id: $id) {
            id date kickoffTime opposition venueName venueCity
            isHome formation goalsScored goalsConceded result
            halfTimeGoalsScored halfTimeGoalsConceded notes
            matchAppearances_on_match {
              isStarter minutesPlayed
              player { id name jerseyNumber position pokemonType }
            }
            matchEvents_on_match(orderBy: { minute: ASC }) {
              id eventType minute note
              player { id name }
              secondaryPlayer { id name }
            }
          }
        }
      `,
      {id: toolInput.id}
    );
  case "list_players":
    return queryDataConnect(`
        query ListPlayers {
          players(orderBy: { jerseyNumber: ASC }) {
            id name jerseyNumber position pokemonType
          }
        }
      `);
  case "get_player":
    return queryDataConnect(
      `
        query GetPlayer($id: UUID!) {
          player(id: $id) {
            id name jerseyNumber position pokemonType
            matchAppearances_on_player {
              isStarter minutesPlayed
              match { id date opposition result }
            }
            matchEvents_on_player {
              id eventType minute note
              match { id date opposition }
            }
          }
        }
      `,
      {id: toolInput.id}
    );
  case "get_events_by_type":
    return queryDataConnect(
      `
        query GetEventsByType($eventType: EventType!) {
          matchEvents(
            where: { eventType: { eq: $eventType } },
            orderBy: { minute: ASC }
          ) {
            id minute note
            match { id date opposition }
            player { id name }
            secondaryPlayer { id name }
          }
        }
      `,
      {eventType: toolInput.eventType}
    );
  case "get_player_events":
    return queryDataConnect(
      `
        query GetPlayerEvents($playerId: UUID!) {
          matchEvents(
            where: { player: { id: { eq: $playerId } } },
            orderBy: { minute: ASC }
          ) {
            id eventType minute note
            match { id date opposition }
            secondaryPlayer { id name }
          }
        }
      `,
      {playerId: toolInput.playerId}
    );
  default:
    return {error: `Unknown tool: ${toolName}`};
  }
}

const SYSTEM_PROMPT =
  "You are the assistant for the manager of Bulbascorers FC, " +
  "a Pokemon-themed football team. All data in the database belongs " +
  "to this team. The manager will ask you questions about their squad, " +
  "match results, player performance, tactical patterns, and more. " +
  "Use the available tools to query real match data before answering. " +
  "Be concise, insightful, and back up observations with specific data " +
  "(e.g. player names, minutes, match dates).";

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
