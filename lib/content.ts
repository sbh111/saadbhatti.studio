import raw from "@/content/content.json";

/**
 * content.json holds only site text. All artwork data — mediums, collections,
 * names, metadata, order — comes from Cloudinary; see lib/catalog.ts.
 */

export interface SiteContent {
  site: {
    title: string;
    intro: string;
    bio: string[];
    contact: { instagram?: string; email?: string };
    /** Local path under /public (starts with "/") or a Cloudinary public id */
    heroImage: string;
    headshotImage: string;
  };
}

export const content = raw as SiteContent;
