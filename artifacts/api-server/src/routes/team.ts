import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { db, farmMembers } from "@workspace/db";
import { currentMember, isHarnold, isMaster, requireMember } from "../lib/farm-access";
import { migrateSheetTaskAssignee } from "../lib/farm-sheet";
import { publicOrigin } from "../lib/public-origin";

const router: IRouter = Router();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

router.get("/me", async (req, res): Promise<void> => {
  try {
    const member = await currentMember(req);
    if (!member) {
      const signedIn = Boolean(getAuth(req).userId);
      res.status(signedIn ? 403 : 401).json({
        code: signedIn ? "farm_membership_pending" : "authentication_required",
        error: signedIn
          ? "This signed-in account is not linked to an approved farm member. Use the invited email, finish email verification, then try again."
          : "Sign in with an approved farm account.",
      });
      return;
    }
    res.json({ ...member, isManager: isMaster(member), isHarnold: isHarnold(member) });
  } catch (error) {
    req.log?.error?.({ err: error }, "Could not finish farm member sign-in");
    res.status(503).json({
      code: "farm_membership_link_failed",
      error: "We could not finish connecting this invitation. Your invitation is still safe; try again in a moment.",
    });
  }
});

router.get("/team", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
   if (!isMaster(member)) { res.status(403).json({ error: "Only the farm owner can manage workers." }); return; }
  res.json(await db.select().from(farmMembers));
});

router.post("/team/invite", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
   if (!isMaster(member)) { res.status(403).json({ error: "Only the farm owner can invite workers." }); return; }
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
   const requestedRole = req.body?.role === "manager" ? "manager" : "worker";
   if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !displayName) {
     res.status(400).json({ error: "A valid email and display name are required." });
     return;
   }
  const pendingId = `pending:${randomUUID()}`;

  try {
    const origin = publicOrigin(req);
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: new URL("/sign-up", origin).toString(),
       publicMetadata: { farmDisplayName: displayName, farmRole: requestedRole },
    });
    const [created] = await db.insert(farmMembers).values({
      clerkId: pendingId, email, displayName, invitationId: invitation.id,
       role: requestedRole, status: "invited",
    }).returning();
    res.status(201).json({ member: created, invitationSent: true, invitationId: invitation.id });
  } catch (error) {
    req.log?.error?.({ err: error, email }, "Could not send farm member invitation");
    res.status(502).json({
      error: "The invitation could not be delivered. No pending member was created.",
      invitationSent: false,
    });
  }
});

router.post("/team/:memberId/resend", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
    if (!isMaster(member)) { res.status(403).json({ error: "Only the farm owner can resend worker invitations." }); return; }

   const [invitee] = await db.select().from(farmMembers).where(eq(farmMembers.clerkId, req.params.memberId));
   if (!invitee || !["worker", "manager"].includes(invitee.role) || invitee.status !== "invited") {
     res.status(404).json({ error: "An invited member was not found." });
    return;
  }

  try {
    const origin = publicOrigin(req);
     if (invitee.invitationId) {
      try {
         await clerkClient.invitations.revokeInvitation(invitee.invitationId);
      } catch (error) {
         req.log?.warn?.({ err: error, invitationId: invitee.invitationId }, "Could not retire earlier farm member invitation before resend");
      }
    }
     const invitation = await clerkClient.invitations.createInvitation({
       emailAddress: invitee.email,
      redirectUrl: new URL("/sign-up", origin).toString(),
       publicMetadata: { farmDisplayName: invitee.displayName, farmRole: invitee.role },
    });
     await db.update(farmMembers).set({ invitationId: invitation.id }).where(eq(farmMembers.clerkId, invitee.clerkId));
    res.json({ invitationSent: true, invitationId: invitation.id });
  } catch (error) {
     req.log?.error?.({ err: error, email: invitee.email }, "Could not resend farm member invitation");
    res.status(502).json({
       error: "The invitation could not be delivered. The existing pending member record was kept.",
      invitationSent: false,
    });
  }
});

router.post("/team/:memberId/revoke", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
    if (!isMaster(member)) { res.status(403).json({ error: "Only the farm owner can revoke worker invitations." }); return; }

  const [revoked] = await db.update(farmMembers)
    .set({ status: "revoked" })
    .where(and(
      eq(farmMembers.clerkId, req.params.memberId),
      eq(farmMembers.status, "invited"),
    ))
    .returning();
  if (!revoked) {
    res.status(404).json({ error: "An invited worker was not found." });
    return;
  }

  if (!revoked.invitationId) {
    res.json({
      member: revoked,
      invitationRevoked: false,
      warning: "Farm access was revoked, but this older sign-up invitation cannot be canceled. It can no longer be used to join the farm.",
    });
    return;
  }

  try {
    await clerkClient.invitations.revokeInvitation(revoked.invitationId);
    res.json({ member: revoked, invitationRevoked: true });
  } catch (error) {
    req.log?.error?.({ err: error, invitationId: revoked.invitationId }, "Could not cancel revoked farm member invitation");
    res.json({
      member: revoked,
      invitationRevoked: false,
      warning: "Farm access was revoked, but the sign-up invitation could not be canceled. It can no longer be used to join the farm.",
    });
  }
});

router.patch("/team/:memberId", async (req, res): Promise<void> => {
  const member = await requireMember(req, res);
  if (!member) return;
    if (!isMaster(member)) { res.status(403).json({ error: "Only the farm owner can manage workers." }); return; }
  const clerkId = typeof req.body?.clerkId === "string" ? req.body.clerkId.trim() : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : undefined;
  if (!clerkId && displayName) {
    if (displayName.length > 120) { res.status(400).json({ error: "Display name is too long." }); return; }
    const [updated] = await db.update(farmMembers).set({ displayName }).where(and(
      eq(farmMembers.clerkId, req.params.memberId),
       eq(farmMembers.role, "worker"),
      eq(farmMembers.status, "active"),
    )).returning();
    if (!updated) { res.status(404).json({ error: "Active worker not found." }); return; }
    res.json(updated);
    return;
  }
  if (!clerkId) { res.status(400).json({ error: "A Clerk user ID is required to approve a worker." }); return; }
   const [invited] = await db.select().from(farmMembers).where(and(
    eq(farmMembers.clerkId, req.params.memberId),
    eq(farmMembers.status, "invited"),
  ));
   if (!invited || !["worker", "manager"].includes(invited.role)) { res.status(404).json({ error: "Member invitation not found." }); return; }

  try {
    const user = await clerkClient.users.getUser(clerkId);
    const verifiedEmail = user.emailAddresses.find((address) =>
      address.id === user.primaryEmailAddressId && address.verification?.status === "verified",
    ) ?? user.emailAddresses.find((address) => address.verification?.status === "verified");
    if (!verifiedEmail || normalizeEmail(verifiedEmail.emailAddress) !== normalizeEmail(invited.email)) {
      res.status(400).json({ error: "The Clerk user must have a verified email matching this invitation." });
      return;
    }
     if (invited.role === "worker") {
       await migrateSheetTaskAssignee(
         invited.invitationId ? [invited.clerkId, invited.invitationId] : invited.clerkId,
         clerkId,
         displayName ?? invited.displayName,
       );
     }
    const [updated] = await db.update(farmMembers).set({
      clerkId, ...(displayName ? { displayName } : {}),
      status: "active",
    }).where(and(
      eq(farmMembers.clerkId, invited.clerkId),
      eq(farmMembers.status, "invited"),
    )).returning();
    if (!updated) { res.status(404).json({ error: "Worker invitation not found." }); return; }
    res.json(updated);
  } catch (error) {
    req.log?.error?.({ err: error, memberId: invited.clerkId }, "Could not migrate invited worker assignments");
    res.status(502).json({ error: "Could not migrate this worker's task assignments. The invitation remains pending." });
  }
});

export default router;