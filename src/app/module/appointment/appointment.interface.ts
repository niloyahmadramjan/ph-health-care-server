export interface IBookAppointmentPayload {
	scheduleId: string;
}

export interface IPayAppointmentPayload {
	appointmentId: string;
}

export interface ICancelAppointmentPayload {
	appointmentId: string;
}

export interface IUpdateAppointment {
	status: "ONGOING" | "COMPLETED";
}
