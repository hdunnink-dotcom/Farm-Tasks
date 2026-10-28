import { and, eq } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import { db, farmMembers, type FarmMember } from "@workspace/db";
import type { Request } from "express";
import { migrateSheetTaskAssignee } from "./farm-sheet";
import { internalMemberId } from "./internal-auth";

export type FarmRole = "manager" | "master" | "worker";

export const authDisabled = process.env.FARM_AUTH_DISABLED === "true";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function linkInvitedMember(clerkId: string): Promise<FarmMember | null> {
  const user = await clerkClient.users.getUser(clerkId);
  const verifiedEmail = user.emailAddresses
    .find((address) => address.id === user.primaryEmailAddressId && address.verification?.status === "verified")
    ?? user.emailAddresses.find((address) => address.verification?.status === "verified");
  const email = verifiedEmail?.emailAddress;
  if (!email) return null;

  const invitedWorkers = await db.select().from(farmMembers).where(eq(farmMembers.status, "invited"));
  const invited = invitedWorkers.find((candidate) =>
    (candidate.role === "worker" || candidate.role === "manager" || candidate.role === "master")
      && normalizeEmail(candidate.email) === normalizeEmail(email),
  );
  if (!invited) return null;

  // Any role can hold task assignments (the move to a new login provider
  // re-invites every member), so carry assignments over for all of them.
  {
    // The Sheet is the assignment source of truth. Do not make this member
    // active until every pending assignment has been moved; failures leave the
    // invitation untouched so the next authenticated request can safely retry.
    await migrateSheetTaskAssignee(
      invited.invitationId ? [invited.clerkId, invited.invitationId] : invited.clerkId,
      clerkId,
      invited.displayName,
    );
  }

  const [linked] = await db.update(farmMembers)
    .set({ clerkId, status: "active" })
    .where(and(
      eq(farmMembers.clerkId, invited.clerkId),
      eq(farmMembers.status, "invited"),
    ))
    .returning();
  return linked ?? null;
}

async function bootstrapOwner(member: FarmMember): Promise<FarmMember> {
  if (member.role !== "worker") return member;
  const configuredMasterId = process.env.FARM_MASTER_CLERK_USER_ID?.trim();
  if (configuredMasterId) {
    if (member.clerkId !== configuredMasterId) return member;
  } else if (process.env.NODE_ENV === "production") {
    return member;
  }
  if (!configuredMasterId) {
    const owners = await db.select().from(farmMembers).where(and(
      eq(farmMembers.role, "master"),
      eq(farmMembers.status, "active"),
    )).limit(1);
    if (owners.length) return member;
  }
  const [promoted] = await db.update(farmMembers)
    .set({ role: "master", status: "active" })
    .where(and(
      eq(farmMembers.clerkId, member.clerkId),
      eq(farmMembers.status, "active"),
      eq(farmMembers.role, "worker"),
    ))
    .returning();
  return promoted ?? member;
}

export async function currentMember(req: Request): Promise<FarmMember | null> {
  if (authDisabled) {
    return {
      clerkId: "test-master",
      email: "test@example.com",
      displayName: "Test farm owner",
      invitationId: null,
      role: "master",
      status: "active",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }
  const internalId = internalMemberId(req);
  if (internalId) {
    const [member] = await db.select().from(farmMembers).where(eq(farmMembers.clerkId, internalId));
    return member && member.status === "active" ? member : null;
  }
  const clerkId = getAuth(req).userId;
  if (!clerkId) return null;
  const [existing] = await db.select().from(farmMembers).where(eq(farmMembers.clerkId, clerkId));
  const masterId = process.env.FARM_MASTER_CLERK_USER_ID?.trim();
  if (existing) return bootstrapOwner(existing);
  const linkedInvitation = await linkInvitedMember(clerkId);
  if (linkedInvitation) return bootstrapOwner(linkedInvitation);
  if (masterId === clerkId || (!masterId && process.env.NODE_ENV !== "production" && (await db.select().from(farmMembers).where(and(
    eq(farmMembers.role, "master"),
    eq(farmMembers.status, "active"),
  )).limit(1)).length === 0)) {
    const [created] = await db.insert(farmMembers).values({
      clerkId, role: "master", status: "active", displayName: "Farm owner",
    }).returning();
    return created ?? null;
  }
  return null;
}

export function isManager(member: FarmMember | null): boolean {
  return (member?.role === "manager" || member?.role === "master")
    && member.status === "active";
}

/** Backward-compatible name used by older routes and stored owner records. */
export function isMaster(member: FarmMember | null): boolean {
  if (!member || !isManager(member)) return false;
  // New manager invitations are fully privileged. Legacy rows that still use
  // "master" remain bound to the configured owner when one is configured.
  if (member.role === "manager") return true;
  const configuredMasterId = process.env.FARM_MASTER_CLERK_USER_ID?.trim();
  return !configuredMasterId || member.clerkId === configuredMasterId;
}

/** Settings and task review are intentionally narrower than the master role. */
export function isHarnold(member: FarmMember | null): boolean {
  const configuredMasterId = process.env.FARM_MASTER_CLERK_USER_ID?.trim();
  return Boolean(configuredMasterId)
    && member?.status === "active"
    && member.clerkId === configuredMasterId;
}

export function isWorker(member: FarmMember | null): boolean {
  return member?.role === "worker" && member.status === "active";
}

export async function requireMember(req: Request, res: { status: (code: number) => { json: (body: unknown) => unknown } }) {
  const member = await currentMember(req);
  if (!member) {
    res.status(401).json({ error: "Sign in with an approved farm account." });
    return null;
  }
  return member;
}