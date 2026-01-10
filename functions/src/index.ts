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

// [START all]
// [START import]
// The Cloud Functions for Firebase SDK to create Cloud Functions and triggers.
import {onRequest} from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";

// The Firebase Admin SDK to access Firestore.
import {initializeApp} from "firebase-admin/app";

initializeApp();
// [END import]

export const calmMeDown = onRequest(
  {secrets: ["ANTHROPIC_API_KEY"]},
  async (req, res) => {
    const anthropicClient = new Anthropic();

    const userInputText = String(req.body?.userInputText || "");

    const artificialInteligenceResponseMessage =
      await anthropicClient.messages.create({
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Take this text and give it a more calming tone. 
            Be humorous with it - ${userInputText}`,
          },
        ],
        model: "claude-sonnet-4-5-20250929",
      });

    const textContent = artificialInteligenceResponseMessage.content[0];

    const text = textContent.type === "text" ? textContent.text : "";

    res.set("Content-Type", "text/html");

    res.send(`
      <html>
        <head>
          <style>
            body {
              font-family: system-ui, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
              line-height: 1.6;
            }
          </style>
        </head>
        <body>${text.replace(/\n/g, "<br>")}</body>
      </html>
    `);
  }
);
