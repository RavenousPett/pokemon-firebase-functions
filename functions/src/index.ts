/**
 * Copyright 2023 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */
"use strict";

import { onRequest } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import { Response } from "express";
import { initializeApp } from "firebase-admin/app";
import { getDataConnect } from "firebase-admin/data-connect";

const app = initializeApp();

// Initialize Data Connect with your service config
const dataConnect = getDataConnect(
  {
    serviceId: "pokemon-football",
    location: "us-east4",
  },
  app,
);

// =====================================================================
// Active team — single-team POC. The AI is currently scoped to one team.
// Replace with a per-request value once we have multi-team / auth.
// =====================================================================
const ACTIVE_TEAM_ID = "2e000000-0000-0000-0000-000000000001";

// Tool definitions for Claude
const tools: Anthropic.Tool[] = [
  {
    name: "get_team_info",
    description:
      "Get the active team's identity (club, team name, age group, " +
      "season). Useful for grounding answers in who the team is.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_all_match_data",
    description:
      "Get every match the team has played (and any postponed/cancelled " +
      "fixtures) with full detail: scores, quarter-by-quarter periods, " +
      "events (goals, corners, fouls, cards, subs, etc.), squad notes, " +
      "and awards. This is the most comprehensive query — use it when " +
      "you need to analyse patterns across the season.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_matches",
    description:
      "Get a quick overview of every match (scores, venue, date, " +
      "result, status). Does NOT include events, periods, or squad " +
      "details. Use for a summary view.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_match",
    description:
      "Get full detail for a specific match: scores, quarter periods, " +
      "events (in period order), squad notes, awards, opp manager and " +
      "referee.",
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
      "Get all active players in the team's squad with their join " +
      "date and position (if known).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_player",
    description:
      "Get a player's profile plus all their match appearances and " +
      "events across the season.",
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
      "Get every event of a specific type across the season. " +
      "Valid types: GOAL_SCORED, GOAL_CONCEDED, ASSIST, CORNER_TAKEN, " +
      "CORNER_CONCEDED, THROW_IN, FREE_KICK_TAKEN, FREE_KICK_CONCEDED, " +
      "SHOT_ON_TARGET, SHOT_OFF_TARGET, SAVE, YELLOW_CARD, RED_CARD, " +
      "FOUL_COMMITTED, FOUL_SUFFERED, SUBSTITUTION_ON, SUBSTITUTION_OFF.",
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
    description: "Get all match events for a specific player.",
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
  variables: Record<string, unknown> = {},
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
  toolInput: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case "get_team_info":
      return queryDataConnect(
        `
        query GetTeam($id: UUID!) {
          team(id: $id) {
            id name ageGroup season defaultPeriodFormat
            club { id name shortName homeVenueName }
          }
        }
      `,
        { id: ACTIVE_TEAM_ID },
      );

    case "get_all_match_data":
      return queryDataConnect(
        `
        query GetAllMatchData($teamId: UUID!) {
          matches(
            where: { ourTeam: { id: { eq: $teamId } } },
            orderBy: { date: DESC }
          ) {
            id date kickoffTime isHome
            opposition oppositionClub
            venueName venueDetails
            status postponementReason periodFormat
            ourGoals theirGoals result
            oppositionManagerName refereeName notes
            matchPeriods_on_match(orderBy: { periodNumber: ASC }) {
              periodNumber label ourGoalsCumulative theirGoalsCumulative
            }
            matchAppearances_on_match {
              status isStarter minutesPlayed
              player { id name jerseyNumber position }
            }
            matchEvents_on_match(orderBy: { periodNumber: ASC }) {
              id eventType periodNumber minute note
              player { id name }
              secondaryPlayer { id name }
            }
            matchAwards_on_match {
              awardType
              player { id name }
            }
          }
        }
      `,
        { teamId: ACTIVE_TEAM_ID },
      );

    case "list_matches":
      return queryDataConnect(
        `
        query ListMatches($teamId: UUID!) {
          matches(
            where: { ourTeam: { id: { eq: $teamId } } },
            orderBy: { date: DESC }
          ) {
            id date kickoffTime isHome
            opposition oppositionClub
            venueName venueDetails
            status postponementReason
            ourGoals theirGoals result
            notes
          }
        }
      `,
        { teamId: ACTIVE_TEAM_ID },
      );

    case "get_match":
      return queryDataConnect(
        `
        query GetMatch($id: UUID!) {
          match(id: $id) {
            id date kickoffTime isHome
            opposition oppositionClub
            venueName venueDetails
            status postponementReason periodFormat
            ourGoals theirGoals result
            oppositionManagerName oppositionManagerPhone
            refereeName notes
            ourTeam { id name ageGroup season club { id name } }
            oppositionTeam { id name ageGroup }
            matchPeriods_on_match(orderBy: { periodNumber: ASC }) {
              periodNumber label ourGoalsCumulative theirGoalsCumulative
            }
            matchAppearances_on_match {
              status isStarter minutesPlayed
              player { id name jerseyNumber position }
            }
            matchEvents_on_match(orderBy: { periodNumber: ASC }) {
              id eventType periodNumber minute note
              player { id name }
              secondaryPlayer { id name }
            }
            matchAwards_on_match {
              id awardType note
              player { id name }
            }
          }
        }
      `,
        { id: toolInput.id },
      );

    case "list_players":
      return queryDataConnect(
        `
        query ListPlayers($teamId: UUID!) {
          players(
            where: { team: { id: { eq: $teamId } }, active: { eq: true } },
            orderBy: { name: ASC }
          ) {
            id name jerseyNumber position joinedDate active
          }
        }
      `,
        { teamId: ACTIVE_TEAM_ID },
      );

    case "get_player":
      return queryDataConnect(
        `
        query GetPlayer($id: UUID!) {
          player(id: $id) {
            id name jerseyNumber position joinedDate active
            team { id name ageGroup season }
            matchAppearances_on_player {
              status isStarter minutesPlayed
              match { id date opposition result }
            }
            matchEvents_on_player {
              id eventType minute periodNumber note
              match { id date opposition }
            }
          }
        }
      `,
        { id: toolInput.id },
      );

    case "get_events_by_type":
      return queryDataConnect(
        `
        query GetEventsByType($teamId: UUID!, $eventType: EventType!) {
          matchEvents(
            where: {
              eventType: { eq: $eventType }
              match: { ourTeam: { id: { eq: $teamId } } }
            },
            orderBy: { periodNumber: ASC }
          ) {
            id periodNumber minute note
            match { id date opposition }
            player { id name }
            secondaryPlayer { id name }
          }
        }
      `,
        { teamId: ACTIVE_TEAM_ID, eventType: toolInput.eventType },
      );

    case "get_player_events":
      return queryDataConnect(
        `
        query GetPlayerEvents($playerId: UUID!) {
          matchEvents(
            where: { player: { id: { eq: $playerId } } },
            orderBy: { periodNumber: ASC }
          ) {
            id eventType periodNumber minute note
            match { id date opposition }
            secondaryPlayer { id name }
          }
        }
      `,
        { playerId: toolInput.playerId },
      );

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

const SYSTEM_PROMPT =
  "You are the data analyst for a grassroots youth football team. " +
  "All data in the database belongs to one team — call `get_team_info` " +
  "first if you need the club/team/age-group/season identity. The " +
  "manager will ask you questions about their squad, match results, " +
  "player performance, tactical patterns, set pieces, discipline, " +
  "etc. Use the available tools to query real match data before " +
  "answering. Be concise, insightful, and back up observations with " +
  "specific data (player names, dates, periods, minute counts where " +
  "available). You can embellish your responses, however do NOT make " +
  "anything up — all answers must be grounded in tool results. " +
  "Notes on the data model: matches are split into periods (quarters " +
  "for under-9s, halves for older age groups). Each match has " +
  "cumulative period scores rather than minute-tagged events for " +
  "every goal, so 'when did we score' usually means 'in which period'. " +
  "Own goals by the opposition appear as `GOAL_SCORED` events with no " +
  "player and a note. `GOAL_CONCEDED` events track goals the opposition " +
  "scored against us (player field is null — the scorer is unknown). " +
  "`SAVE` events track goalkeeper saves (player may be null). " +
  "Awards (`MAN_OF_THE_MATCH`, " +
  "`ASSIST_OF_THE_MATCH`) live in their own table.";

/**
 * Calls Claude with tools and handles the agentic loop.
 * Streams text deltas directly to the HTTP response.
 * @param {Anthropic} anthropicClient - The Anthropic client instance.
 * @param {Anthropic.MessageParam[]} initialMessages - The conversation history.
 * @param {Response} res - Express response to stream text into.
 * @return {Promise<void>}
 */
async function callClaudeWithTools(
  anthropicClient: Anthropic,
  initialMessages: Anthropic.MessageParam[],
  res: Response,
): Promise<void> {
  const messages: Anthropic.MessageParam[] = [...initialMessages];

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
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      // Execute all tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await handleToolCall(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Add assistant response and tool results to messages
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    } else {
      // Claude is done - streaming already happened via the text event
      continueLoop = false;
    }
  }
}

export const calmMeDown = onRequest(
  { secrets: ["ANTHROPIC_API_KEY"], cors: true },
  async (req, res) => {
    const anthropicClient = new Anthropic();
    const incomingMessages = req.body?.messages as
      | Array<{ role: string; content: string }>
      | undefined;
    const userInputText = String(req.body?.userInputText || "");

    // Build the messages array: prefer `messages` (multi-turn),
    // fall back to `userInputText` (single turn / MOTD)
    let initialMessages: Anthropic.MessageParam[];
    if (
      incomingMessages &&
      Array.isArray(incomingMessages) &&
      incomingMessages.length > 0
    ) {
      initialMessages = incomingMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    } else if (userInputText.trim()) {
      initialMessages = [{ role: "user", content: userInputText }];
    } else {
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

      await callClaudeWithTools(anthropicClient, initialMessages, res);
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
  },
);
