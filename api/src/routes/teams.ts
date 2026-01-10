import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../middleware/auth';
import { User, Team, TeamMember, Subscription, Invitation } from '../models';

// Helper to get typed user and userId from request
const getUserId = (req: Request): string => (req as any).userId!;
const getUser = (req: Request): User => (req as any).user as User;
import { sendTeamInvitationEmail } from '../services/email';
import { updateSeatCount } from '../services/stripe';

const router = Router();

// Get all teams for current user
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);

    const teamMembers = await TeamMember.findAll({
      where: { userId },
      include: [
        {
          model: Team,
          as: 'Team',
          include: [
            { model: User, as: 'Owner', attributes: ['id', 'name', 'email', 'avatarUrl'] },
            { model: Subscription, as: 'Subscription' },
          ],
        },
      ],
    });

    const teams = teamMembers.map(tm => ({
      id: tm.Team!.id,
      name: tm.Team!.name,
      role: tm.role,
      owner: tm.Team!.Owner,
      subscription: tm.Team!.Subscription ? {
        plan: tm.Team!.Subscription.plan,
        status: tm.Team!.Subscription.status,
        seatCount: tm.Team!.Subscription.seatCount,
      } : null,
      createdAt: tm.Team!.createdAt,
    }));

    res.json({ teams });
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create a new team
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { name } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Team name is required',
      });
    }

    // Create team
    const team = await Team.create({
      name: name.trim(),
      ownerId: userId,
    });

    // Add owner as team member
    await TeamMember.create({
      teamId: team.id,
      userId,
      role: 'owner',
    });

    // Create default personal subscription for team
    await Subscription.create({
      teamId: team.id,
      plan: 'personal',
      status: 'active',
      seatCount: 1,
    });

    res.status(201).json({
      team: {
        id: team.id,
        name: team.name,
        ownerId: team.ownerId,
        createdAt: team.createdAt,
      },
    });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get team details
router.get('/:teamId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { teamId } = req.params;

    // Check if user is a member of the team
    const membership = await TeamMember.findOne({
      where: { teamId, userId },
    });

    if (!membership) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You are not a member of this team',
      });
    }

    const team = await Team.findByPk(teamId, {
      include: [
        { model: User, as: 'Owner', attributes: ['id', 'name', 'email', 'avatarUrl'] },
        { model: Subscription, as: 'Subscription' },
        {
          model: TeamMember,
          as: 'TeamMembers',
          include: [{ model: User, as: 'User', attributes: ['id', 'name', 'email', 'avatarUrl'] }],
        },
      ],
    });

    if (!team) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Team not found',
      });
    }

    res.json({
      team: {
        id: team.id,
        name: team.name,
        owner: team.Owner,
        subscription: team.Subscription ? {
          plan: team.Subscription.plan,
          status: team.Subscription.status,
          seatCount: team.Subscription.seatCount,
          currentPeriodEnd: team.Subscription.currentPeriodEnd,
        } : null,
        members: team.TeamMembers?.map(tm => ({
          id: tm.User!.id,
          name: tm.User!.name,
          email: tm.User!.email,
          avatarUrl: tm.User!.avatarUrl,
          role: tm.role,
          joinedAt: tm.createdAt,
        })),
        currentUserRole: membership.role,
        createdAt: team.createdAt,
      },
    });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update team
router.put('/:teamId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { teamId } = req.params;
    const { name } = req.body;

    // Check if user is owner or admin
    const membership = await TeamMember.findOne({
      where: { teamId, userId },
    });

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only team owners and admins can update team settings',
      });
    }

    const team = await Team.findByPk(teamId);
    if (!team) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Team not found',
      });
    }

    if (name) {
      await team.update({ name: name.trim() });
    }

    res.json({
      team: {
        id: team.id,
        name: team.name,
        ownerId: team.ownerId,
        updatedAt: team.updatedAt,
      },
    });
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Delete team
router.delete('/:teamId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { teamId } = req.params;

    const team = await Team.findByPk(teamId);
    if (!team) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Team not found',
      });
    }

    // Only owner can delete team
    if (team.ownerId !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only team owner can delete the team',
      });
    }

    // Delete all related data
    await Invitation.destroy({ where: { teamId } });
    await TeamMember.destroy({ where: { teamId } });
    await Subscription.destroy({ where: { teamId } });
    await team.destroy();

    res.json({ message: 'Team deleted successfully' });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get team members
router.get('/:teamId/members', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { teamId } = req.params;

    // Check if user is a member
    const membership = await TeamMember.findOne({
      where: { teamId, userId },
    });

    if (!membership) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You are not a member of this team',
      });
    }

    const members = await TeamMember.findAll({
      where: { teamId },
      include: [{ model: User, as: 'User', attributes: ['id', 'name', 'email', 'avatarUrl'] }],
    });

    res.json({
      members: members.map(m => ({
        id: m.User!.id,
        name: m.User!.name,
        email: m.User!.email,
        avatarUrl: m.User!.avatarUrl,
        role: m.role,
        joinedAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error('Get team members error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update member role
router.patch('/:teamId/members/:memberId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { teamId, memberId } = req.params;
    const { role } = req.body;

    if (!role || !['admin', 'member'].includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid role. Must be "admin" or "member".',
      });
    }

    // Check if user is owner or admin
    const myMembership = await TeamMember.findOne({
      where: { teamId, userId },
    });

    if (!myMembership || !['owner', 'admin'].includes(myMembership.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only team owners and admins can change member roles',
      });
    }

    const memberToUpdate = await TeamMember.findOne({
      where: { teamId, userId: memberId },
    });

    if (!memberToUpdate) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Member not found',
      });
    }

    // Can't change owner's role
    if (memberToUpdate.role === 'owner') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot change the role of the team owner',
      });
    }

    await memberToUpdate.update({ role });

    res.json({
      message: 'Member role updated successfully',
      member: {
        userId: memberId,
        role,
      },
    });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Remove member from team
router.delete('/:teamId/members/:memberId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { teamId, memberId } = req.params;

    // Check if user is owner or admin
    const myMembership = await TeamMember.findOne({
      where: { teamId, userId },
    });

    // Allow self-removal or admin/owner removal
    const isSelfRemoval = userId === memberId;
    const canRemoveOthers = myMembership && ['owner', 'admin'].includes(myMembership.role);

    if (!isSelfRemoval && !canRemoveOthers) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to remove this member',
      });
    }

    const memberToRemove = await TeamMember.findOne({
      where: { teamId, userId: memberId },
    });

    if (!memberToRemove) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Member not found',
      });
    }

    // Can't remove owner
    if (memberToRemove.role === 'owner') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot remove the team owner',
      });
    }

    await memberToRemove.destroy();

    // Update seat count if team has a paid subscription
    const subscription = await Subscription.findOne({ where: { teamId } });
    if (subscription?.stripeSubscriptionId) {
      const memberCount = await TeamMember.count({ where: { teamId } });
      try {
        await updateSeatCount(subscription.id, memberCount);
      } catch (error) {
        console.error('Failed to update seat count:', error);
      }
    }

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get team invitations
router.get('/:teamId/invitations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { teamId } = req.params;

    // Check if user is owner or admin
    const membership = await TeamMember.findOne({
      where: { teamId, userId },
    });

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only team owners and admins can view invitations',
      });
    }

    const invitations = await Invitation.findAll({
      where: { teamId, status: 'pending' },
      include: [{ model: User, as: 'InvitedByUser', attributes: ['id', 'name', 'email'] }],
    });

    res.json({
      invitations: invitations.map(inv => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        invitedBy: inv.InvitedByUser,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
      })),
    });
  } catch (error) {
    console.error('Get invitations error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Send team invitation
router.post('/:teamId/invitations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const user = getUser(req);
    const { teamId } = req.params;
    const { email, role = 'member' } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email is required',
      });
    }

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid role. Must be "admin" or "member".',
      });
    }

    // Check if user is owner or admin
    const membership = await TeamMember.findOne({
      where: { teamId, userId },
    });

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only team owners and admins can send invitations',
      });
    }

    const team = await Team.findByPk(teamId, {
      include: [{ model: Subscription, as: 'Subscription' }],
    });

    if (!team) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Team not found',
      });
    }

    // Check if email is already a member
    const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
    if (existingUser) {
      const existingMember = await TeamMember.findOne({
        where: { teamId, userId: existingUser.id },
      });
      if (existingMember) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'User is already a member of this team',
        });
      }
    }

    // Check if there's already a pending invitation
    const existingInvitation = await Invitation.findOne({
      where: { teamId, email: email.toLowerCase(), status: 'pending' },
    });
    if (existingInvitation) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'An invitation has already been sent to this email',
      });
    }

    // Check seat limit for paid plans
    if (team.Subscription && team.Subscription.plan !== 'personal') {
      const memberCount = await TeamMember.count({ where: { teamId } });
      const pendingInvites = await Invitation.count({ where: { teamId, status: 'pending' } });
      
      if (memberCount + pendingInvites >= team.Subscription.seatCount) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Team has reached its seat limit. Please upgrade to add more members.',
        });
      }
    }

    // Create invitation
    const token = uuidv4();
    const invitation = await Invitation.create({
      teamId,
      email: email.toLowerCase(),
      token,
      role,
      invitedBy: userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    // Send invitation email
    await sendTeamInvitationEmail(
      email.toLowerCase(),
      token,
      team.name,
      user.name || user.email
    );

    res.status(201).json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error) {
    console.error('Send invitation error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Cancel invitation
router.delete('/:teamId/invitations/:invitationId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { teamId, invitationId } = req.params;

    // Check if user is owner or admin
    const membership = await TeamMember.findOne({
      where: { teamId, userId },
    });

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only team owners and admins can cancel invitations',
      });
    }

    const invitation = await Invitation.findOne({
      where: { id: invitationId, teamId },
    });

    if (!invitation) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Invitation not found',
      });
    }

    await invitation.update({ status: 'canceled' });

    res.json({ message: 'Invitation canceled successfully' });
  } catch (error) {
    console.error('Cancel invitation error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Accept invitation (uses token, not teamId)
router.post('/invitations/:token/accept', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { token } = req.params;

    const invitation = await Invitation.findOne({
      where: { token, status: 'pending' },
      include: [{ model: Team, as: 'Team' }],
    });

    if (!invitation) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Invalid or expired invitation',
      });
    }

    if (invitation.expiresAt < new Date()) {
      await invitation.update({ status: 'expired' });
      return res.status(400).json({
        error: 'Bad Request',
        message: 'This invitation has expired',
      });
    }

    // Check if user's email matches invitation email
    const user = await User.findByPk(userId);
    if (user?.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This invitation was sent to a different email address',
      });
    }

    // Check if already a member
    const existingMember = await TeamMember.findOne({
      where: { teamId: invitation.teamId, userId },
    });

    if (existingMember) {
      await invitation.update({ status: 'accepted' });
      return res.status(400).json({
        error: 'Bad Request',
        message: 'You are already a member of this team',
      });
    }

    // Add user to team
    await TeamMember.create({
      teamId: invitation.teamId,
      userId,
      role: invitation.role,
    });

    // Mark invitation as accepted
    await invitation.update({ status: 'accepted' });

    // Update seat count if team has a paid subscription
    const subscription = await Subscription.findOne({ where: { teamId: invitation.teamId } });
    if (subscription?.stripeSubscriptionId) {
      const memberCount = await TeamMember.count({ where: { teamId: invitation.teamId } });
      try {
        await updateSeatCount(subscription.id, memberCount);
      } catch (error) {
        console.error('Failed to update seat count:', error);
      }
    }

    res.json({
      message: 'Invitation accepted successfully',
      team: {
        id: invitation.Team!.id,
        name: invitation.Team!.name,
      },
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

