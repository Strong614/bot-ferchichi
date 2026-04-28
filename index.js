import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import "dotenv/config";

// ─── Config ───────────────────────────────────────────────────────────────────

const BOT_TOKEN       = process.env.BOT_TOKEN;
const MY_GUILD_ID     = process.env.MY_GUILD_ID;
const CHANNEL_ID      = process.env.CHANNEL_ID;
const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID;

for (const [key, val] of Object.entries({ BOT_TOKEN, MY_GUILD_ID })) {
  if (!val || val.startsWith("your_")) {
    console.error(`ERROR: ${key} is not set in .env`);
    process.exit(1);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Week is based on days elapsed since the 27th of the previous month
function getWeek(msgDate, periodStart) {
  const dayOffset = Math.floor((msgDate - periodStart) / 86400000);
  if (dayOffset < 7)  return 1;
  if (dayOffset < 14) return 2;
  if (dayOffset < 21) return 3;
  return 4;
}

function ordinal(n) {
  return ["1st", "2nd", "3rd", "4th"][n - 1];
}

function avg(arr) {
  if (arr.length === 0) return "N/A";
  return (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1);
}

// ─── Embed parser ─────────────────────────────────────────────────────────────
//
// Real embed format:
//   Field "📝 Title"        → "jb 27.04.26"  (DD.MM.YY)
//   Field "🎯 Activity Type" → "Jail Break" or "Event"
//   Field "Members count"   → number (optional, manually entered)

function parseEmbed(embed, msgDate, periodStart) {
  // ── Activity type from "🎯 Activity Type" field ──
  const typeField = embed.fields?.find((f) =>
    f.name.toLowerCase().includes("activity type")
  );
  if (!typeField) return null;

  const typeVal      = typeField.value.trim().toLowerCase();
  const activityType = typeVal.includes("jail") || typeVal === "jb"
    ? "jailbreak"
    : "event";

  // ── Optional members count ──
  const countField = embed.fields?.find((f) =>
    f.name.toLowerCase().includes("members count")
  );
  const highestCount = countField ? parseInt(countField.value, 10) : null;

  return {
    activityType,
    week: getWeek(msgDate, periodStart),
    highestCount: isNaN(highestCount) ? null : highestCount,
  };
}

// ─── Message fetcher ──────────────────────────────────────────────────────────

async function fetchAllMonthMessages(channel, targetMonth, targetYear) {
  const results = [];

  // Period: 27th of previous month → 26th of target month (inclusive)
  // JS Date handles month = -1 correctly (wraps to December of prev year)
  const periodStart = new Date(Date.UTC(targetYear, targetMonth - 2, 27));
  const periodEnd   = new Date(Date.UTC(targetYear, targetMonth - 1, 27)); // exclusive (26th included)

  let lastId       = null;
  let done         = false;
  let totalFetched = 0;

  while (!done) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      const ts = msg.createdAt;

      if (ts >= periodEnd)   continue;
      if (ts < periodStart) { done = true; break; }

      totalFetched++;

      if (!msg.embeds?.length) continue;

      for (const embed of msg.embeds) {
        const parsed = parseEmbed(embed, msg.createdAt, periodStart);
        if (parsed) results.push(parsed);

      }
    }

    lastId = batch.last()?.id;
    if (batch.size < 100) break;

    if (!done) await new Promise((r) => setTimeout(r, 500));
  }

  console.log(
    `[${targetMonth}/${targetYear}] Fetched ${totalFetched} messages, ${results.length} valid activities.`
  );
  return results;
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(activities, targetMonth, targetYear) {
  const monthName = new Date(targetYear, targetMonth - 1, 1).toLocaleString("en-US", {
    month: "long",
  });

  let totalEvents = 0;
  let totalJbs    = 0;
  const allCounts = [];

  const weeks = {
    1: { events: 0, jbs: 0, counts: [] },
    2: { events: 0, jbs: 0, counts: [] },
    3: { events: 0, jbs: 0, counts: [] },
    4: { events: 0, jbs: 0, counts: [] },
  };

  for (const a of activities) {
    const w = weeks[a.week];
    if (a.activityType === "jailbreak") { totalJbs++; w.jbs++; }
    else                                { totalEvents++; w.events++; }

    if (a.highestCount !== null) {
      allCounts.push(a.highestCount);
      w.counts.push(a.highestCount);
    }
  }

  // Week date ranges relative to period start (27th of prev month)
  const periodStart = new Date(Date.UTC(targetYear, targetMonth - 2, 27));
  const weekLabel = (n) => {
    const startOffset = (n - 1) * 7;
    const s = new Date(periodStart.getTime() + startOffset * 86400000);
    const e = n === 4
      ? new Date(Date.UTC(targetYear, targetMonth - 1, 26))
      : new Date(periodStart.getTime() + (startOffset + 6) * 86400000);
    const fmt = (d) => `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
    return `${ordinal(n)} week (${fmt(s)} → ${fmt(e)})`;
  };

  const weekBlock = (n) => {
    const w = weeks[n];
    return (
      `**${weekLabel(n)} :**\n` +
      `Events : ${w.events}\n` +
      `Jbs : ${w.jbs}\n` +
      `Average highest member count: ${avg(w.counts)}`
    );
  };

  return (
    `**Total month activity ${monthName} ${targetYear} :**\n\n` +
    `TOTAL Events : ${totalEvents}\n` +
    `TOTAL Jbs : ${totalJbs}\n` +
    `AVERAGE Highest member count: ${avg(allCounts)}\n\n` +
    weekBlock(1) + "\n\n" +
    weekBlock(2) + "\n\n" +
    weekBlock(3) + "\n\n" +
    weekBlock(4)
  );
}

// ─── Slash command registration ───────────────────────────────────────────────

async function registerCommands(clientId) {
  const now         = new Date();
  const currentYear = now.getFullYear();

  const reportCommand = new SlashCommandBuilder()
    .setName("monthly-report")
    .setDescription("Generate a monthly activity report from the activity channel")
    .addIntegerOption((opt) =>
      opt
        .setName("month")
        .setDescription("Month number (1–12). Defaults to current month.")
        .setMinValue(1)
        .setMaxValue(12)
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("year")
        .setDescription(`Year (e.g. ${currentYear}). Defaults to current year.`)
        .setMinValue(2020)
        .setMaxValue(2100)
        .setRequired(false)
    )
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel to fetch from. Defaults to the one set in .env.")
        .setRequired(false)
    );

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(clientId, MY_GUILD_ID), {
    body: [reportCommand.toJSON()],
  });

  console.log("Command registered: /monthly-report");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands(client.user.id);
  console.log("Ready! Use /monthly-report in your server.");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "monthly-report") return;
  if (interaction.guildId !== MY_GUILD_ID) return;

  const now           = new Date();
  const targetMonth   = interaction.options.getInteger("month") ?? (now.getMonth() + 1);
  const targetYear    = interaction.options.getInteger("year")  ?? now.getFullYear();
  const channelOption = interaction.options.getChannel("channel");

  await interaction.deferReply();

  try {
    const channel = channelOption
      ? await client.channels.fetch(channelOption.id)
      : CHANNEL_ID
        ? await client.channels.fetch(CHANNEL_ID)
        : null;

    if (!channel) {
      await interaction.editReply("Error: No channel specified and no default CHANNEL_ID set in .env.");
      return;
    }

    if (!channel.isTextBased()) {
      await interaction.editReply("Error: That channel is not a text channel.");
      return;
    }

    const activities = await fetchAllMonthMessages(channel, targetMonth, targetYear);
    const report     = buildReport(activities, targetMonth, targetYear);

    // Post to the dedicated report channel if configured, otherwise reply inline
    if (REPORT_CHANNEL_ID) {
      const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
      if (reportChannel?.isTextBased()) {
        await reportChannel.send(report);
        await interaction.editReply(`Report posted in <#${REPORT_CHANNEL_ID}> ✅`);
      } else {
        await interaction.editReply(report);
      }
    } else {
      await interaction.editReply(report);
    }

    console.log(`Report for ${targetMonth}/${targetYear} sent.`);
  } catch (err) {
    console.error("Error generating report:", err);
    await interaction.editReply(`Error: ${err.message ?? "Unknown error."}`);
  }
});

client.login(BOT_TOKEN);
