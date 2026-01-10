import { DataTypes, Model, Sequelize, Optional } from 'sequelize';

export type TeamRole = 'owner' | 'admin' | 'member';

export interface TeamMemberAttributes {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  createdAt: Date;
}

export interface TeamMemberCreationAttributes extends Optional<TeamMemberAttributes, 'id' | 'role' | 'createdAt'> {}

export class TeamMember extends Model<TeamMemberAttributes, TeamMemberCreationAttributes> implements TeamMemberAttributes {
  declare id: string;
  declare teamId: string;
  declare userId: string;
  declare role: TeamRole;
  declare createdAt: Date;

  // Associations
  declare Team?: import('./Team').Team;
  declare User?: import('./User').User;
}

export const setupTeamMember = (sequelize: Sequelize): void => {
  TeamMember.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      teamId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'Teams',
          key: 'id',
        },
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id',
        },
      },
      role: {
        type: DataTypes.ENUM('owner', 'admin', 'member'),
        defaultValue: 'member',
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'TeamMembers',
      timestamps: false,
      indexes: [
        { fields: ['teamId'] },
        { fields: ['userId'] },
        { fields: ['teamId', 'userId'], unique: true },
      ],
    }
  );
};

