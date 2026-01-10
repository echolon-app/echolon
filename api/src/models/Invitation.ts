import { DataTypes, Model, Sequelize, Optional } from 'sequelize';

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'canceled';

export interface InvitationAttributes {
  id: string;
  teamId: string;
  email: string;
  token: string;
  role: 'admin' | 'member';
  status: InvitationStatus;
  invitedBy: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface InvitationCreationAttributes extends Optional<InvitationAttributes, 
  'id' | 'role' | 'status' | 'createdAt'
> {}

export class Invitation extends Model<InvitationAttributes, InvitationCreationAttributes> implements InvitationAttributes {
  declare id: string;
  declare teamId: string;
  declare email: string;
  declare token: string;
  declare role: 'admin' | 'member';
  declare status: InvitationStatus;
  declare invitedBy: string;
  declare expiresAt: Date;
  declare createdAt: Date;

  // Associations
  declare Team?: import('./Team').Team;
  declare InvitedByUser?: import('./User').User;
}

export const setupInvitation = (sequelize: Sequelize): void => {
  Invitation.init(
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
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          isEmail: true,
        },
      },
      token: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      role: {
        type: DataTypes.ENUM('admin', 'member'),
        defaultValue: 'member',
      },
      status: {
        type: DataTypes.ENUM('pending', 'accepted', 'expired', 'canceled'),
        defaultValue: 'pending',
      },
      invitedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id',
        },
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'Invitations',
      timestamps: false,
      indexes: [
        { fields: ['teamId'] },
        { fields: ['email'] },
        { fields: ['token'], unique: true },
        { fields: ['status'] },
      ],
    }
  );
};

