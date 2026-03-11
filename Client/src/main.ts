import * as Phaser from 'phaser';
import * as signalR from '@microsoft/signalr';

// 1. Establish SignalR Connection
// Note: Check your .NET terminal when you run it to confirm it is running on port 5000 or 5104, etc.
const connection = new signalR.HubConnectionBuilder()
    .withUrl("http://localhost:5000/gameHub") // Update this port if .NET uses a different one!
    .withAutomaticReconnect()
    .build();

connection.on("ReceiveHandshake", (message: string) => {
    console.log(`[Server]: ${message}`);
});

connection.start()
    .then(() => console.log("SignalR Connected Successfully!"))
    .catch(err => console.error("SignalR Connection Error: ", err));

// 2. Initialize Phaser
class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    preload() {
        // We will load sprites here later
    }

    create() {
        this.add.text(20, 20, 'Arena Survivor Client Ready', { color: '#00ff00', fontSize: '24px' });
        this.add.text(20, 60, 'Check console for Server connection...', { color: '#ffffff' });
    }
}

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    backgroundColor: '#1a1a1a',
    scene: GameScene,
    parent: 'app', // Matches the div in Vite's index.html
};

const game = new Phaser.Game(config);