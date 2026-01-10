import { Sequelize } from 'sequelize';
import { User, setupUser } from './User';
import { Team, setupTeam } from './Team';
import { TeamMember, setupTeamMember } from './TeamMember';
import { Subscription, setupSubscription } from './Subscription';
import { Invitation, setupInvitation } from './Invitation';

export const setupModels = (sequelize: Sequelize): void => {
  // Initialize all models
  setupUser(sequelize);
  setupTeam(sequelize);
  setupTeamMember(sequelize);
  setupSubscription(sequelize);
  setupInvitation(sequelize);

  // Set up associations
  
  // User associations
  User.hasOne(Subscription, { foreignKey: 'userId', as: 'Subscription' });
  User.hasMany(TeamMember, { foreignKey: 'userId', as: 'TeamMembers' });
  User.hasMany(Team, { foreignKey: 'ownerId', as: 'OwnedTeams' });
  User.hasMany(Invitation, { foreignKey: 'invitedBy', as: 'SentInvitations' });

  // Team associations
  Team.belongsTo(User, { foreignKey: 'ownerId', as: 'Owner' });
  Team.hasMany(TeamMember, { foreignKey: 'teamId', as: 'TeamMembers' });
  Team.hasOne(Subscription, { foreignKey: 'teamId', as: 'Subscription' });
  Team.hasMany(Invitation, { foreignKey: 'teamId', as: 'Invitations' });

  // TeamMember associations
  TeamMember.belongsTo(Team, { foreignKey: 'teamId', as: 'Team' });
  TeamMember.belongsTo(User, { foreignKey: 'userId', as: 'User' });

  // Subscription associations
  Subscription.belongsTo(User, { foreignKey: 'userId', as: 'User' });
  Subscription.belongsTo(Team, { foreignKey: 'teamId', as: 'Team' });

  // Invitation associations
  Invitation.belongsTo(Team, { foreignKey: 'teamId', as: 'Team' });
  Invitation.belongsTo(User, { foreignKey: 'invitedBy', as: 'InvitedByUser' });
};

export { User, Team, TeamMember, Subscription, Invitation };
export type { UserAttributes, UserCreationAttributes } from './User';
export type { TeamAttributes, TeamCreationAttributes } from './Team';
export type { TeamMemberAttributes, TeamMemberCreationAttributes, TeamRole } from './TeamMember';
export type { SubscriptionAttributes, SubscriptionCreationAttributes, PlanType, SubscriptionStatus } from './Subscription';
export type { InvitationAttributes, InvitationCreationAttributes, InvitationStatus } from './Invitation';

