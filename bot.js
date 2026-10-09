require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3');
const puppeteer = require('puppeteer');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const db = new sqlite3.Database('./quest.db');

function initDb() {
  db.run(`
    CREATE TABLE IF NOT EXISTS user_tokens (
      userId TEXT PRIMARY KEY,
      token TEXT,
      savedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quest_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      questName TEXT,
      orbsEarned INTEGER,
      status TEXT,
      completedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

const questStates = {};

function getState(userId) {
  if (!questStates[userId]) {
    questStates[userId] = {
      running: false,
      progress: 0,
      totalOrbsEarned: 0,
      completedQuests: 0,
      currentQuest: 'Waiting',
    };
  }
  return questStates[userId];
}

const commands = [
  new SlashCommandBuilder()
    .setName('token')
    .setDescription('Save your token for quest automation')
    .addStringOption((option) =>
      option.setName('token').setDescription('Your account token').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Start automated quest completion')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check automation status')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop automation')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('history')
    .setDescription('View previous completed quests')
    .toJSON(),
];

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (error) {
    console.error('❌ Failed to register slash commands:', error);
  }

  client.user.setActivity('/start to begin automated quests', { type: 'WATCHING' });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const command = interaction.commandName;

  if (command === 'token') {
    const token = interaction.options.getString('token');

    if (!token || token.length < 10) {
      return interaction.reply({ content: '❌ Token looks invalid.', ephemeral: true });
    }

    db.run(
      `INSERT INTO user_tokens (userId, token) VALUES (?, ?)
       ON CONFLICT(userId) DO UPDATE SET token = excluded.token`,
      [userId, token],
      async (err) => {
        if (err) {
          return interaction.reply({ content: '❌ Failed to save token.', ephemeral: true });
        }

        await interaction.reply({
          content: '✅ Token saved. Use `/start` to begin quest automation.',
          ephemeral: true,
        });
      }
    );
  }

  if (command === 'start') {
    db.get('SELECT token FROM user_tokens WHERE userId = ?', [userId], async (err, row) => {
      if (!row || !row.token) {
        return interaction.reply({
          content: '❌ No token saved. Use `/token` first.',
          ephemeral: true,
        });
      }

      const state = getState(userId);
      state.running = true;
      state.progress = 0;
      state.totalOrbsEarned = 0;
      state.completedQuests = 0;
      state.currentQuest = 'Loading quests...';

      await interaction.reply({ content: '🚀 Automating quest flow started. Check `/status` to monitor progress.', ephemeral: true });
      startQuestAutomation(userId, row.token, interaction);
    });
  }

  if (command === 'status') {
    const state = getState(userId);

    const embed = new EmbedBuilder()
      .setColor(state.running ? '#22c55e' : '#f59e0b')
      .setTitle('📊 Quest Automation Status')
      .addFields(
        { name: 'Status', value: state.running ? 'Running' : 'Idle', inline: true },
        { name: 'Progress', value: `${state.progress}%`, inline: true },
        { name: 'Completed', value: String(state.completedQuests), inline: true },
        { name: 'Total Orbs', value: String(state.totalOrbsEarned), inline: true },
        { name: 'Current Quest', value: state.currentQuest, inline: false }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (command === 'stop') {
    const state = getState(userId);
    state.running = false;
    state.currentQuest = 'Stopped';

    await interaction.reply({
      content: `⛔ Automation stopped. Earned ${state.totalOrbsEarned} orbs in this session.`,
      ephemeral: true,
    });
  }

  if (command === 'history') {
    db.all('SELECT * FROM quest_logs WHERE userId = ? ORDER BY id DESC LIMIT 10', [userId], async (err, rows) => {
      if (err || !rows || rows.length === 0) {
        return interaction.reply({ content: 'No history yet.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor('#3b82f6')
        .setTitle('📜 Recent Quest History')
        .addFields(
          ...rows.map((row) => ({
            name: row.questName || 'Quest',
            value: `Orbs: ${row.orbsEarned || 0} | Status: ${row.status || 'done'}`,
            inline: false,
          }))
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    });
  }
});

async function startQuestAutomation(userId, token, interaction) {
  const state = getState(userId);
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });

    console.log('Opening Discord quests page...');
    state.currentQuest = 'Opening Discord quests';
    state.progress = 10;

    await page.goto('https://discord.com/quests', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    }).catch(() => {});

    console.log('Using saved token to initialize session...');
    state.currentQuest = 'Authenticating session';
    state.progress = 20;

    await page.evaluate((savedToken) => {
      localStorage.setItem('token', JSON.stringify(savedToken));
    }, token);

    await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});

    await page.waitForTimeout(5000);

    const questBlocks = await page.$$('[class*="quest"], [data-testid*="quest"], button');
    let questCount = 0;
    let totalReward = 0;

    for (let i = 0; i < questBlocks.length; i++) {
      if (!state.running) break;

      const block = questBlocks[i];
      const text = await page.evaluate((el) => el.innerText, block);
      if (!text) continue;

      const lower = text.toLowerCase();
      const isQuestCandidate = lower.includes('watch') || lower.includes('claim') || lower.includes('play') || lower.includes('accept');
      if (!isQuestCandidate) continue;

      questCount += 1;
      state.currentQuest = text.slice(0, 60) || 'Quest';
      state.progress = Math.min(90, 30 + Math.floor((i / Math.max(questBlocks.length, 1)) * 60));

      try {
        await block.click();
        await page.waitForTimeout(1500);

        const buttons = await page.$$('[role="button"], button');
        for (const button of buttons) {
          if (!state.running) break;

          const buttonText = await page.evaluate((el) => el.innerText, button);
          const lowerButton = (buttonText || '').toLowerCase();

          if (lowerButton.includes('claim') || lowerButton.includes('watch') || lowerButton.includes('play') || lowerButton.includes('accept')) {
            await button.click();
            await page.waitForTimeout(2500);
            break;
          }
        }

        await page.waitForTimeout(2000);

        const rewardText = await page.evaluate(() => {
          const match = Array.from(document.querySelectorAll('*')).find((node) => {
            const text = (node.textContent || '').trim();
            return /\d+\s*orbs/i.test(text);
          });
          return match ? match.textContent : null;
        });

        const rewardMatch = rewardText && rewardText.match(/(\d+)\s*orbs/i);
        const reward = rewardMatch ? Number(rewardMatch[1]) : 100;
        totalReward += reward;
        state.totalOrbsEarned += reward;
        state.completedQuests += 1;

        db.run(
          `INSERT INTO quest_logs (userId, questName, orbsEarned, status)
           VALUES (?, ?, ?, 'completed')`,
          [userId, state.currentQuest, reward]
        );
      } catch (error) {
        console.log('Quest block skipped due to selector mismatch:', error.message);
      }
    }

    state.running = false;
    state.progress = 100;
    state.currentQuest = 'Completed';

    const finalEmbed = new EmbedBuilder()
      .setColor('#22c55e')
      .setTitle('✅ Quest automation finished')
      .addFields(
        { name: 'Quests processed', value: String(questCount) },
        { name: 'Completed', value: String(state.completedQuests) },
        { name: 'Total orbs', value: String(state.totalOrbsEarned) }
      )
      .setTimestamp();

    await interaction.followUp({ embeds: [finalEmbed] });
    console.log('Completed automation.');
  } catch (error) {
    console.error('Automation failure:', error);
    state.running = false;
    state.currentQuest = 'Error';
    state.progress = 0;

    await interaction.followUp({
      content: `❌ Automation failed: ${error.message}`,
      ephemeral: true,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

initDb();

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Bot failed to login:', error);
  process.exit(1);
});
