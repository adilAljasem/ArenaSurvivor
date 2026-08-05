// =========================================================================
// ECS CORE
// =========================================================================
// A lightweight ECS for the client simulation layer. Entities are just the
// string IDs the server already assigns (connectionId for players, id for
// enemies/projectiles/pickups) — no separate entity-id allocator needed.
// Components are plain data objects keyed by that ID in flat Maps; at this
// entity count (hundreds to low thousands) a Map lookup per component is
// already O(1) and matches how the network payload arrives, so there's no
// need for archetype/bitmask machinery on top. Systems are stateless
// functions/static methods that read and write these component stores
// (see RenderSystems.ts).
//
// PHASE 1 added actor (player + enemy) game-state. PHASE 2 adds pickups
// (ground loot). Projectiles and beams stay on their existing storage in
// main.ts for now — projectiles in particular use a fundamentally different
// per-frame movement model (orbital/linear math mutating sprite.x/y directly
// in the scene's update() loop, not network-tick re-derivation like
// everything else here) and are a deliberately separate, later phase.

export type EntityId = string;

/** Per-actor (player or enemy) game-state, normalized once at network-ingest
 *  time so every system downstream reads clean camelCase fields instead of
 *  re-deriving `actor.x ?? actor.X` style fallbacks on every read. */
export interface ActorComponent {
  isPlayer: boolean;
  configId: string;
  team: string;
  x: number;
  y: number;
  velX: number | undefined;
  actionState: string;
  currentHp: number;
  maxHp: number;
  currentShield: number;
  aimX: number | undefined;
  aimY: number | undefined;
  firedWeapons: number[];
  weapons: { configId: string; slotIndex: number; level: number;[key: string]: any }[];
  currentCastingSkillId: string | undefined;
  currentCastTimer: number;
  maxCastTimer: number;
  stats: any;
}

/** Per-pickup (ground loot) game-state. Pickups never move once spawned, so
 *  unlike ActorComponent there's no per-frame interpolation target here —
 *  just the static data needed to render and identify the item. */
export interface PickupComponent {
  id: EntityId;
  x: number;
  y: number;
  value: number;
  type: number; // 0=Gold, 1=Weapon, 2=Item
  gearConfigId: string;
  level: number;
  totalBaseStats: Record<string, number>;
  rolledStats: Record<string, number>;
  skills: string[];
  isMoving?: boolean;
}

export class World {
  /** The live, persistent component store for every player/enemy currently
   *  known to the client. Replaces re-deriving all actor state from the raw
   *  network array inside the renderer every frame. */
  readonly actors: Map<EntityId, ActorComponent> = new Map();

  /** The live component store for ground loot. Replaces rebuilding a fresh
   *  `Array.from(pickupCache.values())` every network tick just to hand it
   *  to the renderer — systems now read this Map directly. */
  readonly pickups: Map<EntityId, PickupComponent> = new Map();

  upsertActor(id: EntityId, data: ActorComponent): ActorComponent {
    this.actors.set(id, data);
    return data;
  }

  removeActor(id: EntityId): void {
    this.actors.delete(id);
  }

  /** Remove actor components that were not present in the latest complete
   *  player/enemy render pass. Without this, short-lived enemies disappear
   *  visually but remain in the ECS Map for the rest of a long match. */
  pruneActors(activeGroups: readonly ReadonlySet<EntityId>[]): void {
    actorLoop: for (const id of this.actors.keys()) {
      for (const activeIds of activeGroups) {
        if (activeIds.has(id)) continue actorLoop;
      }
      this.actors.delete(id);
    }
  }

  upsertPickup(id: EntityId, data: PickupComponent): PickupComponent {
    this.pickups.set(id, data);
    return data;
  }

  removePickup(id: EntityId): void {
    this.pickups.delete(id);
  }
}

/** One shared world for the running match. Imported directly by systems
 *  rather than threaded through every function call, so existing call sites
 *  in main.ts don't need to change shape for this phase. */
export const world = new World();
