const { app, BrowserWindow } = require('electron');
const path = require('path');

// Spin up your local express server automatically when the desktop app launches
const server = require('./server.js'); 

function createWindow () {
  // Create the native Windows application frame
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Broken Cracker IDE",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load your HTML user interface directly into the desktop window
  win.loadFile('index.html');
}

// Boot the window interface once Electron finishes internal setup
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Completely close out background server operations when the window is closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
