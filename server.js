const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow the frontend to talk to this backend
app.use(cors());
// Parse incoming JSON data
app.use(express.json());

app.post('/compile', (req, res) => {
    // We now expect 'zippedLibs' from the frontend
    const { code, board, zippedLibs } = req.body;

    if (!code || !board) {
        return res.status(400).json({ error: "Missing code or board type." });
    }

    const sketchDir = path.join(__dirname, 'temp_sketch');
    const sketchFile = path.join(sketchDir, 'temp_sketch.ino');
    const libsDir = path.join(sketchDir, 'libraries'); // New folder for our ZIPs

    // Clean up old folders just in case, then create fresh ones
    if (fs.existsSync(sketchDir)) {
        fs.rmSync(sketchDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sketchDir, { recursive: true });
    fs.mkdirSync(libsDir, { recursive: true });

    fs.writeFileSync(sketchFile, code);
    console.log(`Starting compilation for ${board}...`);

    // --- NEW: UNZIP CUSTOM LIBRARIES ---
    if (zippedLibs && zippedLibs.length > 0) {
        zippedLibs.forEach(lib => {
            try {
                console.log(`Unzipping custom library: ${lib.name}`);
                // Remove the "data:application/zip;base64," prefix from the frontend
                const base64Data = lib.data.split(',')[1];
                const zipBuffer = Buffer.from(base64Data, 'base64');
                
                // Unzip directly into our temporary libraries folder
                const zip = new AdmZip(zipBuffer);
                zip.extractAllTo(libsDir, true);
            } catch (err) {
                console.error(`Failed to extract ${lib.name}:`, err);
            }
        });
    }

    // --- KEEPING THE AUTO-DETECT BACKUP LOGIC ---
    // (This still runs in the background just in case they forgot to upload a zip for a standard library)
    const libSet = new Set();
    const regex = /#include\s*[<"]([^>"]+)\.h[>"]/g;
    let match;
    while ((match = regex.exec(code)) !== null) {
        libSet.add(match[1]); 
    }

    const libArray = Array.from(libSet);
    let commandChain = "";

    if (libArray.length > 0) {
        console.log(`Auto-detecting libraries (if not in ZIP): ${libArray.join(', ')}`);
        commandChain = libArray.map(lib => `arduino-cli lib install "${lib}"`).join(' ; ') + ' ; ';
    }

    // --- NEW COMPILE COMMAND ---
    // Notice the --libraries flag! It tells the compiler to check our custom folder first.
    const compileCmd = `${commandChain}arduino-cli compile -b ${board} --libraries ${libsDir} --output-dir ${sketchDir} ${sketchDir}`;

    exec(compileCmd, (error, stdout, stderr) => {
        // If compilation fails and no binary was created
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

            // Clean up the temp folder after a success
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
