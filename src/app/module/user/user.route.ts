import { Router } from "express";
import { upload } from "../../lib/multer";
import { UserController } from "./user.controller";
import { cloudinaryUpload } from "../../lib/cloudinary";

const router = Router();

router.patch("/profile-image",upload.single("profileImage"), UserController.UploadProfileImage);

export const UserRoutes = router;
