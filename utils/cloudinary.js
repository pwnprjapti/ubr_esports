import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.warn("⚠️ WARNING: Cloudinary environment variables (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are missing or incomplete. File uploads to Cloudinary will fail.");
}

/**
 * Uploads a local file to Cloudinary and deletes the local file
 * @param {string} localFilePath - Path to the local file
 * @param {string} folder - Folder name in Cloudinary
 * @returns {Promise<object>} Cloudinary upload response
 */
export const uploadToCloudinary = async (localFilePath, folder = 'ubr_esports') => {
    try {
        if (!localFilePath) return null;

        const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
        const apiKey = (process.env.CLOUDINARY_API_KEY || "").trim();
        const apiSecret = (process.env.CLOUDINARY_API_SECRET || "").trim();

        if (!cloudName || !apiKey || !apiSecret) {
            throw new Error("Cloudinary credentials missing on server. Please configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your hosting environment variables.");
        }

        // Ensure config is applied with fresh, trimmed values
        cloudinary.config({
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret
        });
        
        // Upload the file to cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, {
            folder: folder,
            resource_type: "auto"
        });
        
        // Clean up the local file
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
        
        return response;
    } catch (error) {
        console.error("Cloudinary Upload Error:", error);
        // Ensure local file is cleaned up even on failure
        if (localFilePath && fs.existsSync(localFilePath)) {
            try {
                fs.unlinkSync(localFilePath);
            } catch (e) {
                console.error("Failed to delete local file on error:", e);
            }
        }
        if (error.message && error.message.toLowerCase().includes("cloud_name is disabled")) {
            const currentName = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
            throw new Error(`Cloudinary account '${currentName}' is disabled or suspended by Cloudinary. Please update CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your production hosting Environment Variables.`);
        }
        throw error;
    }
};

/**
 * Deletes an image from Cloudinary using its secure URL
 * @param {string} secureUrl - The secure URL of the image on Cloudinary
 * @returns {Promise<object>} Cloudinary deletion response
 */
export const deleteFromCloudinary = async (secureUrl) => {
    try {
        if (!secureUrl) return null;

        // Extract public ID from secure URL
        // Example URL: https://res.cloudinary.com/demo/image/upload/v1571218039/folder/sample.jpg
        const match = secureUrl.match(/\/upload\/(?:v\d+\/)?([^\.]+)/);
        if (!match) {
            console.warn("Could not parse Cloudinary URL for public ID:", secureUrl);
            return null;
        }

        const publicId = match[1];
        const response = await cloudinary.uploader.destroy(publicId);
        return response;
    } catch (error) {
        console.error("Cloudinary Delete Error:", error);
        throw error;
    }
};
