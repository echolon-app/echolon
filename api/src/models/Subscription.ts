import { DataTypes, Model, Sequelize, Optional } from 'sequelize';

export type PlanType = 'personal' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'incomplete' | 'trialing';

export interface SubscriptionAttributes {
  id: string;
  userId: string | null;
  teamId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: PlanType;
  status: SubscriptionStatus;
  seatCount: number;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionCreationAttributes extends Optional<SubscriptionAttributes, 
  'id' | 'userId' | 'teamId' | 'stripeCustomerId' | 'stripeSubscriptionId' | 
  'status' | 'seatCount' | 'currentPeriodEnd' | 'cancelAtPeriodEnd' | 'createdAt' | 'updatedAt'
> {}

export class Subscription extends Model<SubscriptionAttributes, SubscriptionCreationAttributes> implements SubscriptionAttributes {
  declare id: string;
  declare userId: string | null;
  declare teamId: string | null;
  declare stripeCustomerId: string | null;
  declare stripeSubscriptionId: string | null;
  declare plan: PlanType;
  declare status: SubscriptionStatus;
  declare seatCount: number;
  declare currentPeriodEnd: Date | null;
  declare cancelAtPeriodEnd: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;

  // Associations
  declare User?: import('./User').User;
  declare Team?: import('./Team').Team;
}

export const setupSubscription = (sequelize: Sequelize): void => {
  Subscription.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
      },
      teamId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'Teams',
          key: 'id',
        },
      },
      stripeCustomerId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      stripeSubscriptionId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      plan: {
        type: DataTypes.ENUM('personal', 'pro', 'enterprise'),
        allowNull: false,
        defaultValue: 'personal',
      },
      status: {
        type: DataTypes.ENUM('active', 'canceled', 'past_due', 'incomplete', 'trialing'),
        defaultValue: 'active',
      },
      seatCount: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      currentPeriodEnd: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelAtPeriodEnd: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
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
      tableName: 'Subscriptions',
      timestamps: true,
      indexes: [
        { fields: ['userId'] },
        { fields: ['teamId'] },
        { fields: ['stripeCustomerId'] },
        { fields: ['stripeSubscriptionId'] },
      ],
    }
  );
};

