import passport from 'passport';
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy, Profile as GitHubProfile } from 'passport-github2';
import { User, Subscription } from '../models';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3500/api/auth/oauth/google/callback',
      },
      async (accessToken, refreshToken, profile: GoogleProfile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('No email provided by Google'));
          }

          // Check if user exists with this OAuth ID
          let user = await User.findOne({
            where: { oauthProvider: 'google', oauthId: profile.id },
          });

          if (!user) {
            // Check if user exists with this email
            user = await User.findOne({ where: { email: email.toLowerCase() } });

            if (user) {
              // Link OAuth to existing account
              await user.update({
                oauthProvider: 'google',
                oauthId: profile.id,
                avatarUrl: profile.photos?.[0]?.value || user.avatarUrl,
                emailVerified: true, // Google verifies emails
              });
            } else {
              // Create new user
              user = await User.create({
                email: email.toLowerCase(),
                name: profile.displayName,
                avatarUrl: profile.photos?.[0]?.value,
                oauthProvider: 'google',
                oauthId: profile.id,
                emailVerified: true,
              });

              // Create default personal subscription
              await Subscription.create({
                userId: user.id,
                plan: 'personal',
                status: 'active',
              });
            }
          } else {
            // Update user info
            await user.update({
              avatarUrl: profile.photos?.[0]?.value || user.avatarUrl,
              name: user.name || profile.displayName,
            });
          }

          done(null, user);
        } catch (error) {
          done(error as Error);
        }
      }
    )
  );
}

// GitHub OAuth Strategy
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3500/api/auth/oauth/github/callback',
        scope: ['user:email'],
      },
      async (accessToken: string, refreshToken: string, profile: GitHubProfile, done: (err: Error | null, user?: User) => void) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('No email provided by GitHub'));
          }

          // Check if user exists with this OAuth ID
          let user = await User.findOne({
            where: { oauthProvider: 'github', oauthId: profile.id },
          });

          if (!user) {
            // Check if user exists with this email
            user = await User.findOne({ where: { email: email.toLowerCase() } });

            if (user) {
              // Link OAuth to existing account
              await user.update({
                oauthProvider: 'github',
                oauthId: profile.id,
                avatarUrl: profile.photos?.[0]?.value || user.avatarUrl,
                emailVerified: true,
              });
            } else {
              // Create new user
              user = await User.create({
                email: email.toLowerCase(),
                name: profile.displayName || profile.username,
                avatarUrl: profile.photos?.[0]?.value,
                oauthProvider: 'github',
                oauthId: profile.id,
                emailVerified: true,
              });

              // Create default personal subscription
              await Subscription.create({
                userId: user.id,
                plan: 'personal',
                status: 'active',
              });
            }
          } else {
            // Update user info
            await user.update({
              avatarUrl: profile.photos?.[0]?.value || user.avatarUrl,
              name: user.name || profile.displayName || profile.username,
            });
          }

          done(null, user);
        } catch (error) {
          done(error as Error);
        }
      }
    )
  );
}

// Serialize user for session
passport.serializeUser((user: Express.User, done) => {
  done(null, (user as User).id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export { passport };

