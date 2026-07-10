# Phase 0 Questions, Concerns and Thoughts:
---

So I've looked through the repo and codebase, and have some questions, concerns and thoughts.

* Why are we not using something like React or Vue for components. 
* I'm also thinking of using a different font. I like: Press Start 2P. I would also like the font size slightly bigger
* I would like the collection cover image and images slightly smaller, so that both the image title and image metadata (film metadata) fit onto the screen as well. As it currently doesn't. Some of the images are too big. So the images should scale to fit the screen it's on. To compensate, make the sidebar a little wider as well.
* It looks like some of the medium related logic is hard-coded. Like: ```const noun = medium === "photography" ? "film" : "oil";```. Pkus the medium data in content.json. We should account for many different types of mediums. The medium is mapped to the folders in cloudinary, like so: (root)/&lt;medium&gt;/&lt;collection&gt; We should display them programatically.
* I would like the navbar dropdowns to have fluid motion when dropping down or collapsing. In fact, I would like the whole site to have fluidity. I want the views to quickly phase when switching. I would like the CollectionView to scroll all the way to the selected ArtWork in the collection if clicked.
* I have another crazy idea. I was thinking to have a thin static border along the edge of the entire site. The border image could be a jpg file in local resources, and the everythong else just sits over it, but slightly smaller than than the image and centered so the image borders peek through. Does that make sense. I saved a "siteBroder.png" file in public/images for you to see.

Can we implement these changes as phase 0.5.


# Phase 1a Questions, Concers and Thoughts:
---

I have some thoughts on phase 1a implementation:
* I don't like the admin page and update metadata as it is, it is not what i had in mind. I wanted the additional admin features on CollectionView. Not on a seperate admin page. I only wanted an comments-log under the admin tab, and that's in phase 1b. Can you ask some clarifying questions about this then and implement this.

* I also wanted title and metadata changes to be stored locally, maybe in a cache, then i wanted the option to save all changes to send a bulk update to Cloudinary. I don't want to update and save metadata one image at a time. Can you ask some clarifying questions about this and then implement this.

