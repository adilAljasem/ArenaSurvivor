using Arch.Core;
using Server.Entities;

namespace Server.Core.ECS;

// ==========================================
// ECS COMPONENTS & TAGS (ALL IN ONE FILE)
// ==========================================

// --- Core Physics ---
public struct Position { public float X; public float Y; }
public struct Velocity { public float X; public float Y; }
public struct MovementStat { public float Speed; }

// --- Player Specific ---
public struct PlayerInput { public float X; public float Y; public float AimX; public float AimY; }

// --- AI & Enemies ---
public struct AIWander { public float TargetX; public float TargetY; public float Timer; }
public struct AITarget { public float TargetX; public float TargetY; public bool HasTarget; }

// --- State Tags (Used to filter queries) ---
public struct ActionState { public string CurrentState; public bool IsRootedBySpell; }
public struct DeadTag { }

// --- THE BRIDGE ---
// This holds the reference to your existing OOP classes. 
// At the end of the ECS tick, we copy the fast ECS math back into these objects for the Network!
public struct OOPReference
{
    public BaseActorEntity Actor;
}

// --- Projectiles ---
public struct ProjectileTag { }
public struct OrbitalPhysics { public string OwnerId; public float Radius; public float Speed; public float Angle; }
public struct OOPProjectileRef { public ProjectileEntity Projectile; }


// --- Combat & Collisions ---
public struct Hitbox { public float Radius; }
public struct Faction { public string Team; }

// --- THE EVENT ENTITY ---
// This acts as a "message" from the Physics engine to the RPG engine.
public struct CollisionOverlapEvent 
{ 
    public ProjectileEntity Projectile; 
    public BaseActorEntity Target; 
}