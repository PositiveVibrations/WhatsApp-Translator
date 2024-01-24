const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const translate = require('translate-google');
const fs = require('fs');

const userPreferencesFilePath = './userPreferences.json';
const MAX_TRANSLATION_ATTEMPTS = 5;

function readUserPreferences() {
    if (fs.existsSync(userPreferencesFilePath)) {
        return JSON.parse(fs.readFileSync(userPreferencesFilePath, 'utf8'));
    }
    return {};
}

function writeUserPreferences(userPreferences) {
    fs.writeFileSync(userPreferencesFilePath, JSON.stringify(userPreferences, null, 2));
}

async function translateWithBackoff(message, targetLanguage) {
    for (let attempt = 0; attempt < MAX_TRANSLATION_ATTEMPTS; attempt++) {
        try {
            return await translate(message, { to: targetLanguage });
        } catch (err) {
            if (err.code === 'BAD_NETWORK' && attempt < MAX_TRANSLATION_ATTEMPTS - 1) {
                const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw err;
            }
        }
    }
    throw new Error('Translation failed after maximum retries.');
}

function deleteUserEntryIfDefaultLanguage(userPreferences, userPhoneNumber, defaultLanguage) {
    if (userPreferences[userPhoneNumber] === defaultLanguage) {
        delete userPreferences[userPhoneNumber];
        console.log(`Deleted entry for ${userPhoneNumber} as it was set to the default language.`);
    }
}

const myDefaultLanguage = 'english'; // Set your default language here

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready!');
});

client.on('message_create', async (msg) => {
    console.log("Received message:", msg.body); // Log all received messages
    const userPreferences = readUserPreferences();

    const translationMarker = '🤖';
    const styling = '*';

    if (msg.body.startsWith(translationMarker)) {
        console.log("Skipping already translated message.");
        return;
    }

    if (msg.fromMe && msg.body.toLowerCase().startsWith("set language ")) {
        const words = msg.body.split(" ");
        if (words.length >= 3) {
            const language = words[2].toLowerCase();
            const contact = msg.to;
            if (language === myDefaultLanguage) {
                await msg.reply(`${translationMarker} ${styling}Language set to default.${styling}`);
                console.log(`Language preference set to default for ${contact}`);
                //set their language to default
                userPreferences[contact] = language;
                deleteUserEntryIfDefaultLanguage(userPreferences, contact, myDefaultLanguage);
            } else {
                userPreferences[contact] = language;
                await msg.reply(`${translationMarker} ${styling}Language set to ${language}.${styling}`);
                console.log(`Language preference set to ${language} for ${contact}`);
            }
            writeUserPreferences(userPreferences);
        } else {
            await msg.reply("Invalid format. Use 'set language [language_code]' to set or 'set language default' to reset to default.");
        }
    } else {
        let targetLanguage;
        let contact = msg.fromMe ? msg.to : msg.from;

        // Translate messages from others to your default language
        if (!msg.fromMe && userPreferences[contact]) {
            targetLanguage = myDefaultLanguage;
        }

        // Translate your messages to recipient's preferred language
        if (msg.fromMe && userPreferences[contact]) {
            targetLanguage = userPreferences[contact];
        }

        if (targetLanguage && (targetLanguage !== myDefaultLanguage || !msg.fromMe)) {
            try {
                const translatedMessage = await translateWithBackoff(msg.body, targetLanguage);
                const replyMessage = `${translationMarker} ${styling}${translatedMessage}${styling}`;
                await msg.reply(replyMessage);
                console.log("Translation sent:", replyMessage);
            } catch (err) {
                console.error(err);
                await msg.reply(`${translationMarker} Error in translation. Please try again later.`);
            }
        }
    }
});

client.initialize();
