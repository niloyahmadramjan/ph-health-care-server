/** biome-ignore-all lint/style/useConst: <explanation> */
import bcrypt from "bcryptjs";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import {
  AuthProvider,
  Role,
  UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { jwtUtils } from "../../utils/jwt";
import type {
  IForgetPassPlayload,
  IGoogleLoginPayload,
  ILoginUserPayload,
  IRegisterPatientPayload,
  IRequestUser,
  IResetPassPlayload,
} from "./auth.interface";
import { googleClient } from "../../lib/googleAuth";
import type { TokenPayload } from "google-auth-library";
import crypto from "crypto";
import { redisClient } from "../../lib/redisConfig";
import { sentEmail } from "../../utils/sentEmail";
import ejs from "ejs";
import path from "path";

const registerPatient = async (payload: IRegisterPatientPayload) => {
  const { name, password, patient: patientData } = payload;
  const email = payload.email.trim().toLowerCase();

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (isUserExists) {
    throw new Error("User with this email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 8);

  const createdUser = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: Role.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: false,
      patient: {
        create: { name, email, contactNumber: patientData?.contactNumber },
      },
    },
    omit: { password: true },
    include: { patient: true },
  });

  const { patient, ...user } = createdUser;
  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    user,
    patient,
    accessToken,
    refreshToken,
  };
};

const loginUser = async (payload: ILoginUserPayload) => {
  const { password } = payload;
  const email = payload.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new Error("User is blocked");
  }

  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new Error("User is deleted");
  }

  if (user.password == null && user.googleId !== null) {
    throw new Error("User is already has account try to login with google");
  }

  const isPasswordMatched = await bcrypt.compare(
    password,
    user.password as string,
  );

  if (!isPasswordMatched) {
    throw new Error("Invalid credentials");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const getMe = async (user: IRequestUser) => {
  const isUserExists = await prisma.user.findUnique({
    where: {
      id: user.userId,
    },
    include: {
      patient: true,
    },
    omit: {
      password: true,
    },
  });

  if (!isUserExists) {
    throw new Error("User not found");
  }

  return isUserExists;
};

const refreshToken = async (token: string) => {
  const verifiedRefreshToken = jwtUtils.verifyToken(
    token,
    config.jwt_refresh_secret,
  );

  if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
    throw new Error(
      config.node_env === "development"
        ? verifiedRefreshToken.error
        : "Invalid refresh token",
    );
  }

  const data = verifiedRefreshToken.data as JwtPayload;

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
  });

  if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
    throw new Error("User is inactive or not found");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
  let googleIdTokenPayload: TokenPayload | null | undefined = null;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: payload.idToken,
      audience: config.google_client_id,
    });

    googleIdTokenPayload = ticket.getPayload();
  } catch (error) {
    console.log(error, "Google ID token verification failed");
    throw new Error("Invalid or Expired Google ID Token");
  }

  if (!googleIdTokenPayload) {
    throw new Error("Invalid or Expired Google ID Token");
  }

  if (!googleIdTokenPayload.email) {
    throw new Error("Google email not found");
  }

  if (!googleIdTokenPayload.name) {
    throw new Error("Google name not found");
  }

  const email = googleIdTokenPayload.email;
  const name = googleIdTokenPayload.name;
  const googleId = googleIdTokenPayload.sub;

  let user = await prisma.user.findFirst({
    where: {
      email,
      role: Role.PATIENT,
      googleId,
    },
    include: {
      patient: true,
    },
  });

  // 1. Existing Google user
  if (user) {
    if (user.status === UserStatus.BLOCKED) {
      throw new Error("User is Blocked");
    }

    if (user.isDeleted || user.status === UserStatus.DELETED) {
      throw new Error("User is Deleted");
    }
  }

  // 2. No Google user found
  if (!user) {
    const credentialUser = await prisma.user.findFirst({
      where: {
        email,
        role: Role.PATIENT,
        authProvider: AuthProvider.CREDENTIAL,
      },
      include: {
        patient: true,
      },
    });

    // Existing credential account
    if (credentialUser) {
      if (credentialUser.status === UserStatus.BLOCKED) {
        throw new Error("User is Blocked");
      }

      if (
        credentialUser.isDeleted ||
        credentialUser.status === UserStatus.DELETED
      ) {
        throw new Error("User is Deleted");
      }

      user = await prisma.user.update({
        where: {
          id: credentialUser.id,
        },
        data: {
          googleId,
          authProvider: AuthProvider.GOOGLE,
          emailVerified: true,
        },
        include: {
          patient: true,
        },
      });
    } else {
      // 3. Completely new Google user
      user = await prisma.user.create({
        data: {
          email,
          name,
          authProvider: AuthProvider.GOOGLE,
          role: Role.PATIENT,
          googleId,
          emailVerified: true,
          patient: {
            create: {
              name,
              email,
            },
          },
        },
        include: {
          patient: true,
        },
      });
    }
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const forgetPassword = async (payload: IForgetPassPlayload) => {
  const { email } = payload;

  const isExistUser = await prisma.user.findUniqueOrThrow({
    where: {
      email,
    },
  });
  if (!isExistUser) {
    throw new Error("Invalid email address");
  }
  if (isExistUser.status === "BLOCKED") {
    throw new Error(
      "Oops your account is blocked please contact wiht support center ",
    );
  }
  if (isExistUser.status === "DELETED") {
    throw new Error("Oops your account is deleted ");
  }

  const generateOtp = crypto.randomInt(100000, 1000000);
  const key = `forgetEmailOtp:${email}`;
  await redisClient.set(key, generateOtp, {
    EX: 60 * 5,
  });

  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/forget-password.ejs",
  );

  const html = await ejs.renderFile(templatePath, {
    name: isExistUser.name,
    otp: generateOtp,
    year: new Date().getFullYear(),
  });

  /// email sent function

  await sentEmail.sendMail({
    from: `"PH HEALTH CARE" <${config.smtp_user}>`,
    // to: isExistUser.email,
    to: "mdramjansharifkhan@gmail.com",
    subject: "Password Reset OTP",
    html,
  });

  return { email: isExistUser.email };
};

const resetPassword = async (payload: IResetPassPlayload) => {
  const { email, password, otp } = payload;

  const isExistUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!isExistUser) {
    throw new Error("Inavalid email");
  }

  const key = `forgetEmailOtp:${email}`;
  const getOTP = await redisClient.get(key);
  if (!getOTP) {
    throw new Error("OTP expired try to another one");
  }

  const matchOTP = otp === getOTP;
  if (!matchOTP) {
    throw new Error("OTP expired try again");
  }

  const hashedPassword = await bcrypt.hash(
    password,
    Number(config.bcrypt_salt_rounds),
  );

  await prisma.user.update({
    where: {
      email: isExistUser.email,
    },
    data: {
      password: hashedPassword,
    },
  });

  await redisClient.del(key);

  const tempatePath = path.join(
    process.cwd(),
    "src/app/templates/password-changed.ejs",
  );

  // here implement the email sent function
  /// email sent function
  const html = await ejs.renderFile(tempatePath, {
    name: isExistUser.name,
    email: isExistUser.email,
    date: new Date().toLocaleString(),
    year: new Date().getFullYear(),
  });

  await sentEmail.sendMail({
    from: `"PH HEALTH CARE" <${config.smtp_user}>`,
    // to: isExistUser.email,
    to: "mdramjansharifkhan@gmail.com",
    subject: "Password Changed Successfully",
    html,
  });

  return { email: isExistUser.email };
};

export const AuthService = {
  registerPatient,
  loginUser,
  getMe,
  refreshToken,
  googleLogin,
  forgetPassword,
  resetPassword,
};
