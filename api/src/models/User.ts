import { DataTypes, Model, Sequelize, Optional } from 'sequelize';

export interface UserAttributes {
  id: string;
  email: string;
  passwordHash: string | null;
  name: string | null;
  avatarUrl: string | null;
  oauthProvider: 'google' | 'github' | null;
  oauthId: string | null;
  emailVerified: boolean;
  emailVerificationToken: string | null;
  emailVerificationExpires: Date | null;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCreationAttributes extends Optional<UserAttributes, 
  'id' | 'passwordHash' | 'name' | 'avatarUrl' | 'oauthProvider' | 'oauthId' | 
  'emailVerified' | 'emailVerificationToken' | 'emailVerificationExpires' |
  'passwordResetToken' | 'passwordResetExpires' | 'createdAt' | 'updatedAt'
> {}

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: string;
  declare email: string;
  declare passwordHash: string | null;
  declare name: string | null;
  declare avatarUrl: string | null;
  declare oauthProvider: 'google' | 'github' | null;
  declare oauthId: string | null;
  declare emailVerified: boolean;
  declare emailVerificationToken: string | null;
  declare emailVerificationExpires: Date | null;
  declare passwordResetToken: string | null;
  declare passwordResetExpires: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  // Associations
  declare Subscription?: import('./Subscription').Subscription;
  declare TeamMembers?: import('./TeamMember').TeamMember[];
}

export const setupUser = (sequelize: Sequelize): void => {
  User.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      avatarUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      oauthProvider: {
        type: DataTypes.ENUM('google', 'github'),
        allowNull: true,
      },
      oauthId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      emailVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      emailVerificationToken: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      emailVerificationExpires: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      passwordResetToken: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      passwordResetExpires: {
        type: DataTypes.DATE,
        allowNull: true,
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
      tableName: 'Users',
      timestamps: true,
      indexes: [
        { fields: ['email'], unique: true },
        { fields: ['oauthProvider', 'oauthId'] },
        { fields: ['emailVerificationToken'] },
        { fields: ['passwordResetToken'] },
      ],
    }
  );
};

