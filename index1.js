const axios = require('axios');
const fs = require('fs');
const googleTTS = require('google-tts-api');  // Import Google Text-to-Speech
const player = require('play-sound')({ player: 'vlc' });
const { exec } = require('child_process');
const path = require('path');

const apiKey = '';  // OpenAI API key

const enableAudioPlayback = true;  // Set to false to disable audio playback

// Load the painting JSON file
const paintingData = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'PaintingsAll_EN.json'), 'utf8'));

// Helper function to save audio files in the "Audio" folder with the painting title
function sanitizeTitle(title) {
    return title.replace(/[^a-zA-Z0-9]/g, '_');  // Replace any non-alphanumeric characters with underscores
}

function downloadAudio(url, filename) {
    return axios({
        url,
        responseType: 'stream'
    }).then(response => {
        return new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(filename);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    });
}

// Function to get a description of a painting using ChatGPT-3.5
async function getDescription(title, painter) {
    const prompt = `Give me a description of "${title}" painted by ${painter}.`;
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'user', content: prompt }
                ]
            },
            {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
            }
        );

        return response.data.choices[0].message.content.trim();  // Extract the description
    } catch (error) {
        console.error('Full error:', error.response ? error.response.data : error.message);
        throw new Error('Failed to generate description from ChatGPT');
    }
}

// Function to convert text to speech and save it as an mp3 file
async function readTextAloud(text, sanitizedTitle) {
    const urls = googleTTS.getAllAudioUrls(text, {
        lang: 'en',
        slow: false,
        host: 'https://translate.google.com',
    });

    // Download each part and store filenames
    const filenames = await Promise.all(
        urls.map((urlObj, index) => {
            const filename = `audio${index}.mp3`;
            return downloadAudio(urlObj.url, filename).then(() => filename);
        })
    );

    // Use ffmpeg to concatenate audio files into one mp3 file named after the painting title
    const outputFilename = path.join(__dirname, 'Audio', `${sanitizedTitle}.mp3`);
    const concatCommand = `ffmpeg -y -i "concat:${filenames.join('|')}" -acodec copy ${outputFilename}`;
    
    return new Promise((resolve, reject) => {
        exec(concatCommand, (error) => {
            if (error) {
                console.error('Error combining audio files:', error);
                reject(error);
            } else {
                console.log(`Audio saved as ${outputFilename}`);

                if (enableAudioPlayback) {
                    player.play(outputFilename, (err) => {
                        if (err) {
                            console.log(`Error playing sound: ${err}`);
                        }
                        // Clean up temporary files
                        filenames.forEach(file => fs.unlinkSync(file));
                        resolve();  // Resolve after playing/saving is complete
                    });
                } else {
                    // If playback is disabled, still clean up and resolve
                    filenames.forEach(file => fs.unlinkSync(file));
                    resolve();  //resolve if audio is disabled
                }
                
            }
        });
    });
}

// Main function to handle processing sequentially
async function processPaintingsSequentially(startId, endId) {
    for (let i = startId; i <= endId; i++) {
        const painting = paintingData.ListPainting.find(p => p.id === i);
        if (painting) {
            const title = painting.title;
            const sanitizedTitle = sanitizeTitle(title);  // Sanitize title for use in the filename
            const painterName = `${painting.author[0].firstname} ${painting.author[0].lastname}`;

            console.log(`Processing: ${title} by ${painterName}`);
            
            try {
                const description = await getDescription(title, painterName);
                console.log(`Description: ${description}`);

                // Save description to text file (Check if file is written correctly)
                const descriptionFilePath = path.join(__dirname, 'descriptions.txt');
                try {
                    fs.appendFileSync(descriptionFilePath, `Painting: ${title}\nDescription: ${description}\n\n`);
                    console.log(`Description for "${title}" appended to descriptions.txt.`);
                } catch (fileError) {
                    console.error(`Error writing to descriptions.txt:`, fileError);
                }

                // Convert the description to audio and save it
                await readTextAloud(description, sanitizedTitle);  // Use sanitized title for audio file name
            } catch (error) {
                console.error(`Error processing painting ID ${i}:`, error.message);
            }
        }
    }
}

// Run the main function for IDs 1 to n
processPaintingsSequentially(1, 3);
