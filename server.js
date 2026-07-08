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

    const sketchDir = path.join(__dirname, 'temp_sketch');
    const sketchFile = path.join(sketchDir, 'temp_sketch.ino');

    if (!fs.existsSync(sketchDir)) {
        fs.mkdirSync(sketchDir);
    }

    fs.writeFileSync(sketchFile, code);
    console.log(`Starting compilation for ${board}...`);

    // --- NEW AUTO-DETECT LIBRARIES LOGIC ---
    // This Regex looks for #include <Name.h> or #include "Name.h"
    const regex = /#include\s*[<"]([^>"]+)\.h[>"]/g;
    let match;
    const libSet = new Set(); // Using a Set automatically removes duplicates

    // Scan the code and extract library names
    while ((match = regex.exec(code)) !== null) {
        libSet.add(match[1]); 
    }

    const libArray = Array.from(libSet);
    let commandChain = "";

    if (libArray.length > 0) {
        const formattedLibs = libArray.map(lib => `"${lib}"`).join(' ');
        console.log(`Auto-detected libraries: ${formattedLibs}`);
        
        // Use ';' instead of '&&'. This ensures that if it tries to install a built-in
        // library like 'Wire' and fails, it will still move on to compile the code!
        commandChain = `arduino-cli lib install ${formattedLibs} ; `;
    }

    // Combine the commands
    const compileCmd = `${commandChain}arduino-cli compile -b ${board} --output-dir ${sketchDir} ${sketchDir}`;

    exec(compileCmd, (error, stdout, stderr) => {
        // If the compile command itself fails, it will be caught here
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
    console.log(`Compilation server running on http://localhost:${PORT}`);
});
