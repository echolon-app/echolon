import { Sequelize, Options } from 'sequelize';

export let dbConnected = false;

const options: Options = {
  dialect: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USER || 'echolon',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'echolon',
  pool: {
    max: 50,
    min: 1,
    acquire: 30000,
    idle: 5000,
  },
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
};

if (process.env.NODE_ENV === 'production') {
  options.dialectOptions = {
    ssl: {
      rejectUnauthorized: false,
    },
  };
}

console.log('DB Host: ', options.host);
console.log('DB Port: ', options.port);
console.log('DB Username: ', options.username);
console.log('DB Database: ', options.database);

export const sequelize = new Sequelize(options);

export const initDatabase = async (): Promise<void> => {
  const start = Date.now();
  
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    dbConnected = true;
    console.log('Database connection established successfully.');

    // Import models after connection is established
    const { setupModels } = await import('../models');
    setupModels(sequelize);

    // Sync all models
    if (process.env.NODE_ENV === 'production') {
      await sequelize.sync({ alter: true });
    } else {
      //await sequelize.sync({ alter: true });
    }
    
    console.log('Database models synchronized successfully.');
    console.log(`✅ Database initialization completed in ${Date.now() - start}ms`);
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }
};

export const closeDatabase = async (): Promise<void> => {
  await sequelize.close();
  dbConnected = false;
  console.log('Database connection closed.');
};

