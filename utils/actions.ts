"use server";

import db from "./db";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  imageSchema,
  profileSchema,
  propertySchema,
  validateWithZodSchema,
} from "./schemas";
import { renderError } from "./helpers";
import { uploadImage } from "./supabase";

/**
 * Retrieves the authenticated user.
 * @return {Promise<User>} The authenticated user
 */
const getAuthUser = async () => {
  const user = await currentUser();
  if (!user) {
    throw new Error("You must be logged in to access this route");
  }
  if (!user.privateMetadata.hasProfile) redirect("/profile/create");
  return user;
};

/**
 * Creates a new user profile based on the provided form data.
 * @param {any} prevState - The previous state of the application.
 * @param {FormData} formData - The form data containing the profile details.
 * @return {Promise<{ message: string }>} A promise that resolves to an object with a message indicating the success or failure of the profile creation.
 */
export const createProfileAction = async (
  prevState: any,
  formData: FormData
): Promise<{ message: string }> => {
  try {
    const user = await currentUser();
    if (!user) throw new Error("Please login to create a profile");

    const rawData = Object.fromEntries(formData);
    const validatedFields = validateWithZodSchema(profileSchema, rawData);

    await db.profile.create({
      data: {
        clerkId: user.id,
        email: user.emailAddresses[0].emailAddress,
        profileImage: user.imageUrl ?? "",
        ...validatedFields,
      },
    });
    await clerkClient.users.updateUserMetadata(user.id, {
      privateMetadata: {
        hasProfile: true,
      },
    });
  } catch (error) {
    return renderError(error);
  }
  redirect("/");
};

/**
 * Retrieves the profile image for the authenticated user.
 * @return {Promise<string>} The profile image if it exists, otherwise null.
 */
export const fetchProfileImage = async () => {
  const user = await currentUser();
  if (!user) return null;

  const profile = await db.profile.findUnique({
    where: {
      clerkId: user.id,
    },
    select: {
      profileImage: true,
    },
  });
  return profile?.profileImage;
};

/**
 * Retrieves the profile of the authenticated user.
 * @return {Promise<Profile | null>} The profile object if it exists, otherwise null.
 */
export const fetchProfile = async () => {
  const user = await getAuthUser();

  const profile = await db.profile.findUnique({
    where: {
      clerkId: user.id,
    },
  });
  if (!profile) return redirect("/profile/create");
  return profile;
};

/**
 * Updates the profile of the authenticated user with the provided form data.
 * @param {any} prevState - The previous state of the application.
 * @param {FormData} formData - The form data containing the updated profile details.
 * @return {Promise<{ message: string }>} A promise that resolves to an object with a message indicating the success or failure of the profile update.
 */
export const updateProfileAction = async (
  prevState: any,
  formData: FormData
): Promise<{ message: string }> => {
  const user = await getAuthUser();
  try {
    const rawData = Object.fromEntries(formData);
    const validatedFields = validateWithZodSchema(profileSchema, rawData);

    await db.profile.update({
      where: {
        clerkId: user.id,
      },
      data: validatedFields,
    });
    revalidatePath("/profile");
    return { message: "Profile updated successfully" };
  } catch (error) {
    return renderError(error);
  }
};

/**
 * Updates the profile image for a user.
 * @param {any} prevState - The previous state of the application.
 * @param {FormData} formData - The form data containing the profile image.
 * @return {Promise<{ message: string }>} A promise that resolves to an object with a message indicating the success or failure of the operation.
 */
export const updateProfileImageAction = async (
  prevState: any,
  formData: FormData
) => {
  const user = await getAuthUser();
  try {
    const image = formData.get("image") as File;
    const validatedFields = validateWithZodSchema(imageSchema, { image });
    const fullPath = await uploadImage(validatedFields.image);

    await db.profile.update({
      where: {
        clerkId: user.id,
      },
      data: {
        profileImage: fullPath,
      },
    });
    revalidatePath("/profile");
    return { message: "Profile image updated successfully" };
  } catch (error) {
    return renderError(error);
  }
};

/**
 * Creates a new property using the provided form data.
 *
 * @param {any} prevState - The previous state of the application.
 * @param {FormData} formData - The form data containing the property details.
 * @return {Promise<{ message: string }>} A promise that resolves to an object with a message indicating the success or failure of the operation.
 */
export const createPropertyAction = async (
  prevState: any,
  formData: FormData
): Promise<{ message: string }> => {
  const user = await getAuthUser();
  try {
    const rawData = Object.fromEntries(formData);
    const file = formData.get("image") as File;

    const validatedFields = validateWithZodSchema(propertySchema, rawData);
    const validatedFile = validateWithZodSchema(imageSchema, { image: file });
    const fullPath = await uploadImage(validatedFile.image);

    await db.property.create({
      data: {
        ...validatedFields,
        image: fullPath,
        profileId: user.id,
      },
    });
  } catch (error) {
    return renderError(error);
  }
  redirect("/");
};

/**
 * Asynchronously fetches properties based on search criteria and category.
 *
 * @param {string} search - The search keyword to filter properties.
 * @param {string} category - The category to filter properties.
 * @return {Promise<Property[]>} An array of properties matching the search criteria.
 */
export const fetchProperties = async ({
  search = "",
  category,
}: {
  search?: string;
  category?: string;
}) => {
  const properties = await db.property.findMany({
    where: {
      category,
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { tagline: { contains: search, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      tagline: true,
      country: true,
      image: true,
      price: true,
    },
  });
  return properties;
};

/**
 * Fetches the favorite ID for a given property ID and user ID.
 *
 * @param {string} params.propertyId - The ID of the property.
 * @return {Promise<string|null>} The favorite ID if it exists, otherwise null.
 */
export const fetchFavoriteId = async ({
  propertyId,
}: {
  propertyId: string;
}) => {
  const user = await getAuthUser();
  const favorite = await db.favorite.findFirst({
    where: {
      propertyId,
      profileId: user.id,
    },
    select: {
      id: true,
    },
  });
  return favorite?.id || null;
};

/**
 * Toggles the favorite action based on the previous state.
 *
 * @param {Object} prevState - The previous state object containing propertyId, favoriteId, and pathname.
 * @return {Promise<Object>} A message indicating whether the property was added or removed from favorites.
 */
export const toggleFavoriteAction = async (prevState: {
  propertyId: string;
  favoriteId: string | null;
  pathname: string;
}) => {
  const user = await getAuthUser();
  const { propertyId, favoriteId, pathname } = prevState;
  try {
    if (favoriteId) {
      await db.favorite.delete({
        where: {
          id: favoriteId,
        },
      });
    } else {
      await db.favorite.create({
        data: {
          propertyId,
          profileId: user.id,
        },
      });
    }
    revalidatePath(pathname);
    return { message: favoriteId ? "Removed from Faves" : "Added to Faves" };
  } catch (error) {
    return renderError(error);
  }
};

/**
 * Fetches the favorite properties for the authenticated user.
 *
 * @return {Property[]} The list of favorite properties.
 */
export const fetchFavorites = async () => {
  const user = await getAuthUser();
  const favorites = await db.favorite.findMany({
    where: {
      profileId: user.id,
    },
    select: {
      property: {
        select: {
          id: true,
          name: true,
          tagline: true,
          price: true,
          country: true,
          image: true,
        },
      },
    },
  });
  return favorites.map((favorite) => favorite.property);
};

export const fetchPropertyDetails = (id: string) => {
  return db.property.findUnique({
    where: {
      id,
    },
    include: {
      profile: true,
    },
  });
};
