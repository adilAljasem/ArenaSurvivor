namespace Server.Entities;

public class PickupEntity
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public float X { get; set; }
    public float Y { get; set; }
    public int Value { get; set; } // How much gold this is worth
}