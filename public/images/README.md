# Sign-in photograph

The sign-in screen is built around one photograph of this business
actually working: shelves, stock, somebody checking a load. Drop it here
as

    public/images/warehouse.jpg

and it appears on the next deploy - no code change. The panel is designed
to stand on its own until then, so a missing file is never a broken
image.

## What the picture should be

Your own warehouse, van loading, or trade counter. A real photograph of
this business beats any stock library, and it is the whole point of the
panel: somebody signing in should recognise the place they work.

If a stock photograph is used instead it must be licensed for commercial
use - Unsplash, Pexels and Openverse all have warehouse and distribution
sets that are. Avoid anything carrying another company's branding.

## What it should look like

    subject      shelving, cartons, stock being handled, a van loading
    orientation  portrait or square crops best - the panel is tall on
                 desktop and short and wide on a phone
    size         about 1600x2000, under ~400 KB compressed
    format       .jpg, or .webp if the reference in
                 src/app/sign-in/page.tsx is renamed to match

The left of the frame carries white text over a dark scrim, so a picture
whose detail sits to the right survives the crop best.

## Compressing it

    sips -Z 2000 original.jpg --out public/images/warehouse.jpg

Check it lands under 400 KB. Much larger is a slow sign-in on a phone in
a yard, which is exactly where this screen is used.
