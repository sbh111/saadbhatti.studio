# saadbhatti.studio

# The Executive Plan:

We are designing a minimal personal site for displaying photos and artwork hosted on saadbhatti.studio. Using hi-res jpgs stored on a cloud-based DB (Cloudinary, S3, etc…) to serve the content on the site. 

Note: This is just a rough/initial plan. I am not to familiar with front-end concepts, but you are Claude, so you will help me refine this further.

### Phase 0:

Lets have a site that displays high-res images of my content. The content will be jpgs of my photography and painting works. 
It will have also have a landing/home page with some welcoming content. A picture of me holding some art and a quick intro about myself. 
There will be a dedicated about-me page with more information and my contact.

There are several components/ideas I have that i want on the site, let me describe them below.

#### Side Bar Menu/Panel:

I want a side bar/panel that  follows the tree below. It is on the left side of the page and takes up an 1/8th of the screen. It stretches the whole length (top to bottom) of the page. It is also persistent, it shouldn’t go away, I always want it there displaying the current tree structure. If the tree grows too large for the panel length, I want to be able to scroll the tree.

At the top of the Panel, I want my full name, bolded and large. 
Lets have a global font. Some thing simple and modern. Im thinking Calibri.

Collapsible Side Panel Tree Structure:
about me/ (click links to the AboutMeView, displayed on Main View Area.)

art/ (click drops down to list all the ArtMedium(s) I work in, currently only photography and oil painting. click doesn’t link anywhere.)

photography/collections/ (click drops down to list all collections. click also links to a page which displays CollectionsView on Main View Area. I’ll describe the collections view below.)

“Photo Collection 1”/ (Example collection. Clicking drops down ArtWork(s) in this Collection. Clicking also loads CollectionView.)

“Photo 1” (Clicking an ArtWork jumps to the position where the ArtWork is in the CollectionView, since CollectionView is scrollable.)

“Photo 2”

…

“Photo Collection 2”

…

oil paintings/collections/

“Painting Collection 1”/

“Painting 1”

“Painting 2”

…

“Painting Collection 2”

…

#### Main View Area:

This Area is to the left of the side panel. It takes up the rest of the page. I want the views I describe below to take up this area when loaded. I’m unsure of what to call this in front-end terms.

#### LandingView:

This is the main landing/home page for when you arrive to the site. It starts with an image. It’ll be of me holding a brush or something. And below it would be a short intro. “Howdy, I’m Saad Bhatti, and welcome to my studio. Feel free to explore my work”. That can be the initial intro. 

#### AboutMeView:

When a user clicks on the About Me tab, it directs here. It is pretty simple. It’ll just have information about who I am and what the site is about. Along with my contact info.

#### ArtMedium class:

A class that describes the art medium the works are in. 
It holds a list of Collection(s).

#### CollectionsView:

It displays the list of Collection(s) associated with a selected ArtMedium in the Main View Area. The view displays the name and the first ArtWork image below it when displaying a collection; This can be a ClickableBox. Clicking on the ClickableBox links to the CollectionView for the selected Collection.

#### Collection Class:

A Collection is a class that holds the name of the Collection and a list of ArtWork(s) associated with the Collection.

#### CollectionView:

A CollectionView displays the list of ArtWork(s) as scrollable list of ClickableBox(es). The ClicakbleBox holds and displays the name of the ArtWork and And an Image of the ArtWork.

I want the Image to almost span the whole width of the Main View Area, maybe leave a tiny gap, few pixels big.

In this case, I don’t want the ClickableBox to link anywhere. Maybe in the future, it can link to a ArtWorkView in which you can buy a print. However, that can be for a later phase/iteration of the site.

#### ArtWork class:

Holds a hi-res image of the ArtWork and holds the name.


Those were some of my component and layout ideas. Remember, this is a rough draft, I am not familiar with Front-End and I’m sure i’m missing many things. Please help me refine this plan and fill out the information gaps that you need to execute this plan cleanly.


==========================================================================================================================

# Phase 1 Plan

Here are some Ideas I have for phase 1:
* An Admin User, which gets certain features/abilities.:
	* The ability to modify titles and metadata of Images.
	* The ability to modify image order inside a collection. Maybe a right sidebar pops up when in Collection View in which I can drag and modify the order of images. There should be an 'apply changes' button that pushes the changes to Cloudinary API.

* Lets use typescript and nodejs for the backend. If we need to save modified data before pushing, we could use a lightweight DB. Would that work with vercel hosting?
