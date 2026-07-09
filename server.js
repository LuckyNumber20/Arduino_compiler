const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Core system headers that ship out-of-the-box with Arduino cores (ignore these)
const BUILT_IN_LIBRARIES = new Set([
    "Wire", "SPI", "EEPROM", "SoftwareSerial", "HID", "Keyboard", "Mouse", "WiFi", "FS", "SD"
]);

// Memory cache to prevent re-searching and re-installing libraries during this server lifecycle
const installedCache = new Set();

/**
 * Searches the official Arduino Registry for a library that provides the given header file,
 * then installs it automatically via the CLI.
 */
const lookupAndInstallLibrary = (headerName) => {
    return new Promise((resolve) => {
        if (installedCache.has(headerName) || BUILT_IN_LIBRARIES.has(headerName)) {
            return resolve();
        }

        console.log(`Searching Arduino Registry for a library providing: <${headerName}.h>...`);
        
        // Query the live database for any library containing this specific header file interface
        const searchQuery = `arduino-cli lib search "provides:${headerName}.h" --format json`;
        
        exec(searchQuery, (err, stdout, stderr) => {
            if (err) {
                console.log(`Registry search failed for ${headerName}.h: ${stderr || err.message}`);
                installedCache.add(headerName); // Add to cache to prevent endless lookup loops
                return resolve();
            }

            try {
                const searchData = JSON.parse(stdout);
                
                // Confirm the Registry returned valid matching libraries
                if (searchData && searchData.libraries && searchData.libraries.length > 0) {
                    // Extract the primary matching library details
                    const bestMatch = searchData.libraries[0];
                    const libraryRealName = bestMatch.name || (bestMatch.library && bestMatch.library.name);
                    
                    if (libraryRealName) {
                        console.log(`Found official match: "${libraryRealName}". Commencing installation...`);
                        
                        // Perform standard Arduino IDE library installation
                        exec(`arduino-cli lib install "${libraryRealName}"`, (installErr) => {
                            if (installErr) {
                                console.log(`Installation error for ${libraryRealName}: ${installErr.message}`);
                            } else {
                                console.log(`Successfully installed: ${libraryRealName} ✅`);
                            }
                            installedCache.add(headerName);
                            resolve();
                        });
                        return;
                    }
                }
            } catch (parseError) {
                console.log(`Failed to parse registry response for ${headerName}.h`);
            }
            
            // Fallback if the registry lookup yielded nothing clean
            installedCache.add(headerName);
            resolve();
        });
    });
};

app.post('/compile', async (req, res) => {
    const { code, board } = req.body;

    if (!code || !board) {
        return res.status(400).json({ error: "Missing code or board type." });
    }

    // 1. Scan the raw incoming code string for all #include directives
    const includeRegexp = /#include\s*[<"]([^>"]+)\.h[>"]/g;
    let match;
    const detectedHeaders = [];

    while ((match = includeRegexp.exec(code)) !== null) {
        const headerName = match[1];
        if (!BUILT_IN_LIBRARIES.has(headerName)) {
            detectedHeaders.push(headerName);
        }
    }

    // 2. Resolve and download missing dependencies through the live Arduino Index
    if (detectedHeaders.length > 0) {
        console.log(`Analyzing sketch inclusions: ${detectedHeaders.map(h => `<${h}.h>`).join(', ')}`);
        await Promise.all(detectedHeaders.map(header => lookupAndInstallLibrary(header)));
    }

    // 3. Set up the temporary build sketch environment
    const sketchDir = path.join(__dirname, 'temp_sketch');
    const sketchFile = path.join(sketchDir, 'temp_sketch.ino');

    if (fs.existsSync(sketchDir)) {
        fs.rmSync(sketchDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sketchDir, { recursive: true });
    fs.writeFileSync(sketchFile, code);

    console.log(`Compiling project files for target: ${board}...`);
    const compileCmd = `arduino-cli compile -b ${board} --output-dir ${sketchDir} ${sketchDir}`;

    // 4. Fire the compilation engine
    exec(compileCmd, (error, stdout, stderr) => {
        if (error && !fs.existsSync(path.join(sketchDir, 'temp_sketch.ino.hex')) && !fs.existsSync(path.join(sketchDir, 'temp_sketch.ino.bin'))) {
            console.error(`Compilation error trace:\n${stderr}`);
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

            // Cleanup local filesystem space
            fs.rmSync(sketchDir, { recursive: true, force: true });

            return res.json({ 
                success: true, 
                message: stdout,
                binaryData: base64Data 
            });
        } else {
            return res.status(500).json({ error: "Could not locate compiled runtime binary file." });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Universal Arduino-Compliant Compiler Server initialized on port ${PORT}`);
});
