const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Core built-in architectures libraries that should never be re-downloaded
const BUILT_IN_LIBRARIES = new Set([
    "Wire", "SPI", "EEPROM", "SoftwareSerial", "HID", "Keyboard", "Mouse", "WiFi", "FS", "SD"
]);

const installedCache = new Set();

/**
 * Three-tier smart download engine:
 * 1. Checks basic built-ins
 * 2. Matches common shorthand exceptions (like DHT)
 * 3. Queries registry with an automatic direct name fallback (like FastLED)
 */
const lookupAndInstallLibrary = (headerName) => {
    return new Promise((resolve) => {
        if (installedCache.has(headerName) || BUILT_IN_LIBRARIES.has(headerName)) {
            return resolve();
        }

        console.log(`Checking dependency requirement for: <${headerName}.h>`);

        // Tier 1: Micro-dictionary for tricky libraries where header doesn't match the package name
        const commonOverrides = {
            "DHT": "DHT sensor library",
            "Adafruit_Sensor": "Adafruit Unified Sensor",
            "LiquidCrystal_I2C": "LiquidCrystal I2C"
        };

        if (commonOverrides[headerName]) {
            const directLibName = commonOverrides[headerName];
            console.log(`[Override Match] Installing known package: "${directLibName}"`);
            exec(`arduino-cli lib install "${directLibName}"`, () => {
                installedCache.add(headerName);
                resolve();
            });
            return;
        }

        // Tier 2: Search the online database index
        const searchQuery = `arduino-cli lib search "provides:${headerName}.h" --format json`;
        exec(searchQuery, (err, stdout, stderr) => {
            // Default Fallback: If registry finds nothing, use the header string directly (e.g. FastLED)
            let libraryTargetName = headerName; 

            if (!err && stdout) {
                try {
                    const searchData = JSON.parse(stdout);
                    if (searchData && searchData.libraries && searchData.libraries.length > 0) {
                        const bestMatch = searchData.libraries[0];
                        libraryTargetName = bestMatch.name || (bestMatch.library && bestMatch.library.name) || headerName;
                        console.log(`[Registry Match] Found official mapping: "${libraryTargetName}"`);
                    }
                } catch (parseErr) {
                    // Fallback string retained on JSON parse failure
                }
            }

            // Tier 3: Trigger the physical installation process
            console.log(`[Installer] Executing download command for: "${libraryTargetName}"`);
            exec(`arduino-cli lib install "${libraryTargetName}"`, (installErr, instStdout, instStderr) => {
                if (installErr) {
                    console.log(`[Installer Note] Handled output for ${libraryTargetName}: ${instStderr || installErr.message}`);
                } else {
                    console.log(`[Installer Success] Library environment ready: ${libraryTargetName} ✅`);
                }
                installedCache.add(headerName);
                resolve(); // Safe to continue to compiler engine
            });
        });
    });
};

app.post('/compile', async (req, res) => {
    const { code, board } = req.body;

    if (!code || !board) {
        return res.status(400).json({ error: "Missing code or board type." });
    }

    const includeRegexp = /#include\s*[<"]([^>"]+)\.h[>"]/g;
    let match;
    const detectedHeaders = [];

    while ((match = includeRegexp.exec(code)) !== null) {
        const headerName = match[1];
        if (!BUILT_IN_LIBRARIES.has(headerName)) {
            detectedHeaders.push(headerName);
        }
    }

    // Await all background installations completely before allowing compiler compilation step to run
    if (detectedHeaders.length > 0) {
        await Promise.all(detectedHeaders.map(header => lookupAndInstallLibrary(header)));
    }

    const sketchDir = path.join(__dirname, 'temp_sketch');
    const sketchFile = path.join(sketchDir, 'temp_sketch.ino');

    if (fs.existsSync(sketchDir)) {
        fs.rmSync(sketchDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sketchDir, { recursive: true });
    fs.writeFileSync(sketchFile, code);

    console.log(`Compiling files for target hardware: ${board}...`);
    const compileCmd = `arduino-cli compile -b ${board} --output-dir ${sketchDir} ${sketchDir}`;

    exec(compileCmd, (error, stdout, stderr) => {
        if (error && !fs.existsSync(path.join(sketchDir, 'temp_sketch.ino.hex')) && !fs.existsSync(path.join(sketchDir, 'temp_sketch.ino.bin'))) {
            console.error(`Compilation failure logging trace:\n${stderr}`);
            return res.status(500).json({ error: "Compilation failed", details: stderr });
        }

        console.log("Compilation complete and verified successful!");

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
            return res.status(500).json({ error: "Unable to find binary production artifacts." });
        }
    });
});

app.post('/flash', (req, res) => {
    const { board, port } = req.body; // e.g., board: "esp32", port: "COM3"
    
    if (!port) {
        return res.status(400).json({ error: "No COM port selected." });
    }

    const sketchDir = path.join(__dirname, 'temp_sketch');
    const binFile = path.join(sketchDir, 'temp_sketch.ino.bin');

    if (!fs.existsSync(binFile)) {
        return res.status(400).json({ error: "No compiled binary found. Please compile first." });
    }

    console.log(`Flashing ESP32 on port ${port}...`);

    // The official desktop command to flash an ESP32 over native serial
    const flashCmd = `python -m esptool --chip esp32 --port ${port} --baud 921600 write_flash -z 0x10000 ${binFile}`;

    exec(flashCmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`Flashing failed: ${stderr}`);
            return res.status(500).json({ error: "Upload failed", details: stderr });
        }

        console.log("Upload successful!");
        return res.json({ success: true, message: "Board flashed successfully! ✅", output: stdout });
    });
});

app.listen(PORT, () => {
    console.log(`Cloud Compiler Active on port ${PORT}`);
    
    // CRITICAL: Synchronize the local package index with the global database on startup
    console.log("Synchronizing official Arduino database indices...");
    exec("arduino-cli lib update-index", (err, stdout, stderr) => {
        if (err) {
            console.error("Warning: Database index syncing encountered issues:", stderr || err.message);
        } else {
            console.log("Arduino Database index synchronization complete! Ready for dynamic downloads.");
        }
    });
});
