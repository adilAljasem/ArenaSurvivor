using Microsoft.AspNetCore.SignalR;

namespace Server.Hubs;

public class GameHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        Console.WriteLine($"Player connected: {Context.ConnectionId}");
        // Send a test message back to the client that just connected
        await Clients.Caller.SendAsync("ReceiveHandshake", "Welcome to Arena Survivor!");
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        Console.WriteLine($"Player disconnected: {Context.ConnectionId}");
        await base.OnDisconnectedAsync(exception);
    }
}