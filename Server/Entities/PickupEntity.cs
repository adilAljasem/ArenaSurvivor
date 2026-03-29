namespace Server.Entities;

public class PickupEntity
{
    private static int _pickupIdCounter = 0;
    public string Id { get; set; } = Interlocked.Increment(ref _pickupIdCounter).ToString();
    public float X { get; set; }
    public float Y { get; set; }
    public int Value { get; set; } // How much gold this is worth
}