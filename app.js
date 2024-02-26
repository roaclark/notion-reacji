const crypto = require("crypto");
const express = require("express");
const bodyParser = require("body-parser");
const { Client } = require("@notionhq/client");
require("dotenv").config();

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const app = express();
const port = process.env.PORT;

app.use(bodyParser.json());

function verifySlackSignature(req) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  const baseString = `v0:${timestamp}:${JSON.stringify(req.body)}`;
  const computedSignature = `v0=${crypto
    .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
    .update(baseString)
    .digest("hex")}`;
  if (
    !crypto.timingSafeEqual(
      Buffer.from(computedSignature),
      Buffer.from(signature)
    )
  ) {
    console.error("slack signature mismatch")
    throw "signatures did not match";
  }
}

async function getTaskConfigFromEmoji(emoji) {
  console.log("fetching emoji config")
  const response = await notion.databases.query({
    database_id: process.env.EMOJI_DB_ID,
    filter: {
      property: "Emoji",
      rich_text: {
        equals: emoji,
      },
    },
  });
  if (!response.results) {
    console.error("invalid response", { emoji, response });
    return null;
  }
  if (response.results.length <= 0) {
    return null;
  }
  const teams = response.results[0].properties["Teams"].relation.map(
    (r) => r.id
  );
  const projects = response.results[0].properties["Projects"].relation.map(
    (r) => r.id
  );
  return {
    teams,
    projects,
  };
}

async function createTask({ title, teams, projects }) {
  console.log("creating task")
  const response = await notion.pages.create({
    parent: {
      type: "database_id",
      database_id: process.env.TASK_DB_ID,
    },
    properties: {
      Name: {
        title: [
          {
            text: {
              content: title,
            },
          },
        ],
      },
      Teams: {
        relation: teams.map((t) => ({ id: t })),
      },
      Projects: {
        relation: projects.map((p) => ({ id: p })),
      },
    },
  });
  return response;
}

async function createTaskFromEmoji({ emoji, title }) {
  if (!emoji || !title) {
    return "no task data";
  }
  const taskData = await getTaskConfigFromEmoji(emoji);
  if (!taskData) {
    return "emoji not found";
  }
  const result = await createTask({
    title,
    ...taskData,
  });
  return result;
}

app.post("/slack", async (req, res) => {
  verifySlackSignature()
  const { type, challenge, event } = req.body;
  if (type === "url_verification") {
    console.log("challenge accepted")
    return res.send(challenge);
  } else if (type === "event_callback") {
    console.log("processing slack event")
    if (event.type === "reaction_added") {
      console.log("reaction added")
      console.log(event)
      const { reaction } = event;
      const response = await createTaskFromEmoji({
        emoji: reaction,
        title: "Auto title",
      });
      return res.send(response);
    }
  } else {
    console.log("unrecognized slack event", {type})
    return res.send();
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
