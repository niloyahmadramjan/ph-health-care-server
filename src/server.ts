import app from "./app";
import config from "./app/config";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redisConfig";
import { seedSuperAdmin, seedTesterAdmin, seedTesterDoctor } from "./app/utils/seedAccount";

const PORT = config.port;

const main = async () => {
	try {
		await prisma.$connect();
		await redisClient.connect()
		console.log("redis db connected")
		await seedSuperAdmin()
		await seedTesterAdmin()
		await seedTesterDoctor()
		
		app.listen(PORT, () => {
			console.log(`Server is running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
