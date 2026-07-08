const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow the frontend to talk to this backend
app.use(cors());
// Parse incoming JSON data
app.use(express.json());

app.post('/compile', (req, res) => {
    const { code, board } = req.body;

    if (!code || !board) {
        return res.status(400).json({ error: "Missing code or board type." });
    }

    // Create a temporary folder and sketch file
    const sketchDir = path.join(__dirname, 'temp_sketch');
    const sketchFile = path.join(sketchDir, 'temp_sketch.ino');

    // Ensure directory exists
    if (!fs.existsSync(sketchDir)) {
        fs.mkdirSync(sketchDir);
    }

    // Write the frontend's C++ code into the .ino file
    fs.writeFileSync(sketchFile, code);

    console.log(`Starting compilation for ${board}...`);

    // Run the arduino-cli command
    // Example board: "arduino:avr:uno" or "esp32:esp32:esp32s3"
    const compileCmd = `arduino-cli compile -b ${board} --output-dir ${sketchDir} ${sketchDir}`;

    exec(compileCmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`Compilation error: ${stderr}`);
            return res.status(500).json({ error: "Compilation failed", details: stderr });
        }

        console.log("Compilation successful!");

        // Locate the compiled binary (e.g., .hex for AVR, .bin for ESP32)
        // Arduino CLI puts these in the output directory we specified
        const hexPath = path.join(sketchDir, 'temp_sketch.ino.hex');
        const binPath = path.join(sketchDir, 'temp_sketch.ino.bin');

        let compiledFilePath = null;
        if (fs.existsSync(hexPath)) compiledFilePath = hexPath;
        if (fs.existsSync(binPath)) compiledFilePath = binPath;

        if (compiledFilePath) {
            // Read the file and send it back as base64 or a buffer
            const fileData = fs.readFileSync(compiledFilePath);
            const base64Data = fileData.toString('base64');

            // Clean up: delete the temporary files after sending
            fs.rmSync(sketchDir, { recursive: true, force: true });

            return res.json({ 
                success: true, 
                message: stdout,
                binaryData: base64Data // The frontend will decode this to flash the board
            });
        } else {
            return res.status(500).json({ error: "Could not find compiled binary." });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Compilation server running on http://localhost:${PORT}`);
});
