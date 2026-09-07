import { addDays, differenceInMinutes, startOfDay } from "date-fns";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { ICreateSchedulePayload } from "./schedule.interface";
import httpStatus from "http-status";
import { IQuery } from "../doctor/doctor.interface";
import { ScheduleWhereInput } from "../../../generated/prisma/models";

const createShedule = async (
  payload: ICreateSchedulePayload,
  user: RequestUser,
) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      id: user.userId,
    },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor  profile not found");
  }

  const startOfTheDay = startOfDay(payload.startDateTime);
  const startOfNextDay = addDays(startOfTheDay, 1);

  const existingScheduleOnThisDate = await prisma.schedule.findFirst({
    where: {
      doctorId: user.userId,
      isDeleted: false,
      startDateTime: {
        gte: startOfTheDay,
        lt: startOfNextDay,
      },
    },
  });

  if (existingScheduleOnThisDate) {
    throw new AppError(
      httpStatus.CONFLICT,
      "You already have a schedule for this Date",
    );
  }
  const durationInMinute = differenceInMinutes(
    payload.startDateTime,
    payload.endDateTime,
  );
  const minute_allocated_per_slot = 20;
  const totalSlots = Math.floor(durationInMinute / minute_allocated_per_slot);

  const schedule = await prisma.schedule.create({
    data: {
      startDateTime: payload.startDateTime,
      endDateTime: payload.endDateTime,
      meetingLink: payload.meetingLink,
      totalSlots,
      availableSlots: totalSlots,
      doctorId: user.userId,
    },
    include: {
      doctor: true,
    },
  });
  return schedule;
};

const getMySchedule = async (query: IQuery, user: RequestUser) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor profile not found!");
  }

  let limit = 10;
  if (query.limit) {
    limit = Number(query.limit);
  }

  let page = 1;
  if (query.page) {
    page = Number(query.page);
  }

  const skip = (page - 1) * limit;

  const andConditions: ScheduleWhereInput[] = [
    {
      doctorId: doctor.id,
    },
    {
      isDeleted: false,
    },
  ];

  if (query.status) {
    andConditions.push({ status: query.status });
  }

  const schedule = await prisma.schedule.findMany({
    where: {
      AND: andConditions,
    },
    take: limit,
    skip,
    orderBy: { startDateTime: "desc" },
    include: {
        appointments: {
            include: {
                patient: true
            }
        }

    }
  });


  const total = await prisma.schedule.count({
    where: {
      AND: andConditions,
    },
  });

  return {
    data: schedule,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };
};



export const ScheduleService = {
  createShedule,
  getMySchedule,
};
