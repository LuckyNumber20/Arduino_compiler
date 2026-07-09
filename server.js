const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

app.post('/compile', (req, res) => {
    const { code, board } = req.body;

    if (!code || !board) {
        return res.status(400).json({ error: "Missing code or board type." });
    }

    const sketchDir = path.join(__dirname, 'temp_sketch');
    const sketchFile = path.join(sketchDir, 'temp_sketch.ino');

    if (fs.existsSync(sketchDir)) {
        fs.rmSync(sketchDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sketchDir, { recursive: true });

    fs.writeFileSync(sketchFile, code);
    console.log(`Starting compilation for ${board}...`);

    // Standard compilation command without custom library flags
    const compileCmd = `arduino-cli compile -b ${board} --output-dir ${sketchDir} ${sketchDir}`;

    exec(compileCmd, (error, stdout, stderr) => {
        if (error && !fs.existsSync(path.join(sketchDir, 'temp_sketch.ino.hex')) && !fs.existsSync(path.join(sketchDir, 'temp_sketch.ino.bin'))) {
            console.error(`Compilation error: ${stderr}`);
            return res.status(500).json({ error: "Compilation failed", details: stderr });
        }

        console.log("Compilation successful!");

        const hexPath = path.join(sketchDir, 'temp_sketch.ino.hex');
        const binPath = path.join(sketchDir, 'temp_sketch.ino.bin');

        let compiledFilePath = null;
        if (fs.existsSync(hexPath)) compiledFilePath = hexPath;
        if (fs.existsSync(binPath)) compiledFilePath = binPath;

        if (compiledFilePath) {
            const fileData = fs.readFileSync(compiledFilePath);
            const base64Data = fileData.toString('base64');

            fs.rmSync(sketchDir, { recursive: true, force: true });

            return res.json({ 
                success: true, 
                message: stdout,
                binaryData: base64Data 
            });
        } else {
            return res.status(500).json({ error: "Could not find compiled binary." });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Compilation server running on port ${PORT}`);
});
