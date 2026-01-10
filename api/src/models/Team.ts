import { DataTypes, Model, Sequelize, Optional } from 'sequelize';

export interface TeamAttributes {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamCreationAttributes extends Optional<TeamAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class Team extends Model<TeamAttributes, TeamCreationAttributes> implements TeamAttributes {
  declare id: string;
  declare name: string;
  declare ownerId: string;
  declare createdAt: Date;
  declare updatedAt: Date;

  // Associations
  declare Owner?: import('./User').User;
  declare TeamMembers?: import('./TeamMember').TeamMember[];
  declare Subscription?: import('./Subscription').Subscription;
  declare Invitations?: import('./Invitation').Invitation[];
}

export const setupTeam = (sequelize: Sequelize): void => {
  Team.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      ownerId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id',
        },
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'Teams',
      timestamps: true,
      indexes: [
        { fields: ['ownerId'] },
      ],
    }
  );
};

