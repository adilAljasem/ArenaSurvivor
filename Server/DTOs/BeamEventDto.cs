namespace Server.DTOs;

public class BeamEventDto
{
    public float StartX { get; set; }
    public float StartY { get; set; }
    public float TargetX { get; set; }
    public float TargetY { get; set; }
    public float Width { get; set; }
    public string ColorTint { get; set; } = string.Empty;
}