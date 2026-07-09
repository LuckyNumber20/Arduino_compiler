const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const drivelist = require('drivelist');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);  // NEW: Wrap express in standard HTTP for WebSockets
const wss = new WebSocket.Server({ server }); // NEW: WebSocket instance

app.use(cors());
app.use(express.json());

const PORT = 10000;
// ... keep your existing sketchDir setups and endpoints here ...
const sketchDir = path.join(__dirname, 'temp_sketch');
const sketchFile = path.join(sketchDir, 'temp_sketch.ino');

// Create temporary directory setup if missing on bootup
if (!fs.existsSync(sketchDir)) {
    fs.mkdirSync(sketchDir, { recursive: true });
}

// 1. Active Serial Mappings Scan
app.get('/ports', async (req, res) => {
    try {
        const portList = await SerialPort.list();
        const formattedPorts = portList.map(port => ({
            path: port.path,
            friendlyName: `${port.path} (${port.manufacturer || 'Unknown Hardware'})`
        }));
        res.json(formattedPorts);
    } catch (err) {
        console.error('Error scanning serial hardware:', err);
        res.status(500).json({ error: 'Failed to scan hardware registry links' });
    }
});

// 2. Local Compiler Runner Execution Endpoint
app.post('/compile', (req, res) => {
    const { code } = req.body;
    
    fs.writeFileSync(sketchFile, code || '');

    const compileCmd = `arduino-cli compile --fqbn esp32:esp32:esp32da "${sketchDir}"`;

    exec(compileCmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: stderr || stdout });
        }
        res.json({ success: true, output: stdout });
    });
});

// 3. Hardware Flash Runner Execution Endpoint
app.post('/flash', (req, res) => {
    const { port } = req.body;
    const binFile = path.join(sketchDir, 'build', 'esp32.esp32.esp32da', 'temp_sketch.ino.bin');
    const alternateBinFile = path.join(sketchDir, 'temp_sketch.ino.bin');
    const finalBin = fs.existsSync(binFile) ? binFile : alternateBinFile;

    const flashCmd = `python -m esptool --chip esp32 --port ${port} --baud 921600 write_flash -z 0x10000 "${finalBin}"`;

    exec(flashCmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: "Upload failed", details: stderr || stdout });
        }
        res.json({ success: true, message: "Board flashed successfully! ✅", output: stdout });
    });
});

// 4. NEW FEATURE: Local Hard Drive Sketch File Preservation Endpoint
app.post('/save-sketch', (req, res) => {
    const { sketchName, code } = req.body;
    if (!sketchName) return res.status(400).json({ error: "Sketch title assignment configuration pattern missed." });

    const targetDirectory = path.join(__dirname, 'saved_sketches', sketchName);

    try {
        if (!fs.existsSync(targetDirectory)) {
            fs.mkdirSync(targetDirectory, { recursive: true });
        }
        fs.writeFileSync(path.join(targetDirectory, `${sketchName}.ino`), code || '');
        res.json({ success: true, message: `Sketch folder parameters locked and saved under: saved_sketches/${sketchName}/${sketchName}.ino` });
    } catch (err) {
        res.status(500).json({ error: "Hard drive parsing failed writing system data logs.", details: err.message });
    }
});

// 5. NEW FEATURE: Local Hard Drive Sketch Recovery File Endpoint
app.get('/load-sketch', (req, res) => {
    const sketchName = req.query.name;
    if (!sketchName) return res.status(400).json({ error: "Missing directory path tracking name definition query parameter." });

    const targetFile = path.join(__dirname, 'saved_sketches', sketchName, `${sketchName}.ino`);

    if (!fs.existsSync(targetFile)) {
        return res.status(404).json({ error: `File asset search trace came back completely empty matching signature: ${sketchName}.ino` });
    }

    try {
        const fileContents = fs.readFileSync(targetFile, 'utf-8');
        res.json({ success: true, code: fileContents });
    } catch (err) {
        res.status(500).json({ error: "Failed tracking local hardware system file reader layers.", details: err.message });
    }
});

// 6. NEW FEATURE: Architecture Object Library Generation Endpoint
app.post('/create-library', (req, res) => {
    const { libraryName } = req.body;
    if (!libraryName) return res.status(400).json({ error: "Object interface declaration namespace string parameters omitted." });

    // Installs class tracking properties directly into the local compiler includes search paths map folder tree
    const targetLibraryDirectory = path.join(__dirname, 'temp_sketch', 'src', libraryName);

    try {
        if (!fs.existsSync(targetLibraryDirectory)) {
            fs.mkdirSync(targetLibraryDirectory, { recursive: true });
        }

        const headerDefinitionBlockStringTemplate = `#ifndef ${libraryName}_h\n#define ${libraryName}_h\n\n#include "Arduino.h"\n\nclass ${libraryName} {\n  public:\n    ${libraryName}();\n    void begin();\n};\n\n#endif`;
        const codeExecutionCPlusPlusBlockStringTemplate = `#include "${libraryName}.h"\n\n${libraryName}::${libraryName}() {}\n\nvoid ${libraryName}::begin() {\n  // Inject workspace loops here\n}`;

        fs.writeFileSync(path.join(targetLibraryDirectory, `${libraryName}.h`), headerDefinitionBlockStringTemplate);
        fs.writeFileSync(path.join(targetLibraryDirectory, `${libraryName}.cpp`), codeExecutionCPlusPlusBlockStringTemplate);

        res.json({ success: true, message: `Created structural context include file templates inside build workspace directories paths loop loops!` });
    } catch (err) {
        res.status(500).json({ error: "System directory creation failed executing internal IO paths parameters.", details: err.message });
    }
});

// --- SSH WEBSOCKET HANDLER ---
wss.on('connection', (ws) => {
    let sshClient = new Client();

    ws.on('message', (message) => {
        const parsed = JSON.parse(message);

        if (parsed.action === 'connect') {
            sshClient.on('ready', () => {
                sshClient.shell((err, stream) => {
                    if (err) return ws.send(`\r\n*** SSH Shell Error: ${err.message} ***\r\n`);
                    
                    // Route data from Pi to Frontend
                    stream.on('data', (data) => ws.send(data.toString()));
                    
                    // Route data from Frontend to Pi
                    ws.on('message', (msg) => {
                        const innerParsed = JSON.parse(msg);
                        if (innerParsed.action === 'input') {
                            stream.write(innerParsed.data);
                        }
                    });
                    
                    stream.on('close', () => {
                        sshClient.end();
                        ws.close();
                    });
                });
            }).on('error', (err) => {
                ws.send(`\r\n*** SSH Connection Error: ${err.message} ***\r\n`);
                ws.close();
            }).connect({
                host: parsed.host,
                port: 22,
                username: parsed.user,
                password: parsed.pass
            });
        }
    });

    ws.on('close', () => {
        sshClient.end();
    });
});

// --- PI IMAGER: DRIVE SCANNER ---
app.get('/drives', async (req, res) => {
    try {
        const drives = await drivelist.list();
        // Safety: Filter ONLY for removable drives (USB/SD Cards) to prevent wiping the main hard drive
        const removableDrives = drives.filter(d => d.isRemovable || d.isUSB);
        res.json(removableDrives);
    } catch (err) {
        res.status(500).json({ error: "Failed to scan system drives" });
    }
});

// --- PI IMAGER: FLASH ENDPOINT ---
app.post('/flash-image', (req, res) => {
    const { imagePath, device } = req.body;
    
    if (!fs.existsSync(imagePath)) {
        return res.status(400).json({ error: "Image file not found on disk." });
    }

    // NOTE: Writing raw images requires Admin/Sudo privileges. 
    // This command assumes a Unix environment using 'dd'. 
    // On Windows, this requires wrapping a tool like 'rufus' or 'balena-cli-flasher'.
    const isWin = process.platform === "win32";
    let cmd = isWin 
        ? `echo "Raw disk writing on Windows requires specialized elevated binaries."` 
        : `sudo dd if="${imagePath}" of="${device}" bs=4M status=progress`;

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: "Flash sequence failed. You may need Administrator/Root privileges.", details: stderr || stdout });
        }
        res.json({ message: "OS successfully flashed to drive!", details: stdout });
    });
});
// --- ENCRYPTION ENGINE (.bkc files) ---
const ALGORITHM = 'aes-256-cbc';
// This is your master app key. It MUST be exactly 32 characters long!
const MASTER_KEY = 'BrokenCrackerSuperSecretKey12345'; 

// Helper function to scramble code
function encryptCode(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // We return both the scrambled text AND the "iv" (initialization vector) needed to unlock it
    return `${iv.toString('hex')}:${encrypted}`;
}

// Helper function to unscramble code
function decryptCode(hash) {
    const parts = hash.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Endpoint to Save Encrypted .bkc File Locally
app.post('/save-encrypted', (req, res) => {
    const { filename, code } = req.body;
    try {
        const encryptedData = encryptCode(code);
        // Save as your custom proprietary file type
        fs.writeFileSync(path.join(__dirname, `${filename}.bkc`), encryptedData);
        res.json({ message: "Successfully encrypted and saved as .bkc!" });
    } catch (err) {
        res.status(500).json({ error: "Encryption failed." });
    }
});
server.listen(PORT, () => {
    console.log(`Desktop IDE & Terminal Engine running on http://localhost:${PORT}`);
});

module.exports = app;
