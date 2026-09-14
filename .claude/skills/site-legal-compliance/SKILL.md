---
name: site-legal-compliance
description: Use whenever building, reviewing, or shipping any user-facing website or web app — especially one built by rapid "vibe coding," where functionality gets tested but the boring required stuff doesn't. Trigger before any site goes live, and whenever a page, form, or third-party script/embed is added. Also trigger on "privacy policy," "terms of use," "cookie banner," "GDPR," "accessibility," "alt text," "fake reviews," "returns policy," "third-party disclosure," "is this site compliant," or "is this legal." Checks the full set of legal pages, consent enforcement, data minimization, accessibility, and honest-marketing requirements a real production site needs — not a generic checklist, but audited against what this specific site actually does.
---

# Site Legal & Accessibility Compliance

A site built fast gets tested for whether the buttons work — not for whether it's
legally exposed, inaccessible to real users, or making claims it can't back up. Those
gaps don't show up in normal testing; they show up as a complaint, a fine, or a user
who simply can't use the site. This file is a checklist to catch them before shipping,
not after.

**This is not legal advice.** For a site handling real customer data or operating
under a specific jurisdiction's requirements (GDPR, the Israeli Privacy Protection Law,
ADA, etc.), a lawyer should still review the result. This skill catches the common
structural and technical gaps — a missing policy, a banner that doesn't actually block
anything, an unlabeled button — not the legal judgment calls a lawyer makes.

## Legal pages & policies

- **Privacy Policy** — must describe what *this site actually collects*, not a generic
  template. A copied policy that lists data types the site doesn't collect, or omits
  ones it does, is worse than having none — it's a false legal statement, not just an
  incomplete one.
- **Terms of Use** — covers what the site/service actually does, not boilerplate for a
  different kind of product.
- **Cookie Policy** — names the actual categories of cookies in use (essential,
  analytics, marketing) and realistic retention, not a placeholder list.
- **Returns/Refund Policy** — only relevant if the site sells something; check it
  matches the actual fulfillment/refund process, not a copied generic policy.
- **Image/content copyright** — stock images, generated images, and user-submitted
  images each carry different rights; confirm the site has the right to use what it's
  using and credits where required.

## Consent & data minimization

- **Cookie consent that actually gates loading** — a banner that renders but doesn't
  block non-essential scripts (analytics, ad pixels) until the user consents is not
  consent, it's decoration. Check the technical enforcement, not just that the banner
  appears.
- **Form consent tied to the Privacy Policy** — any form collecting personal data needs
  an explicit consent checkbox/statement, linked to the actual policy describing what
  happens to that data.
- **Data minimization** — does the form collect only the fields the site actually needs,
  or extra fields pulled in from a generic template/form library?
- **Analytics & third-party disclosure** — every analytics tool and third-party
  embed/widget (chat, maps, payment, social) sends data somewhere else; each one needs
  to be named in the Privacy Policy, since "third party" isn't a detail users can
  discover on their own.

## Accessibility — checked against the rendered site, not the design

- **Alt text** on every meaningful image (not decorative filler text like "image1.jpg").
- **Color contrast** meets at least WCAG AA for body text and interactive elements —
  check actual computed colors, not how it looks to the person who already knows what
  the button says.
- **Full keyboard operability** — every interactive element (nav, forms, modals,
  carousels) reachable and usable with keyboard alone, not just mouse/touch. This is
  also where custom-styled buttons/divs-acting-as-buttons most often silently fail.
- **Descriptive labels** on buttons and links — "click here" or a bare icon with no
  accessible name fails for screen readers even when it's visually obvious to a sighted
  mouse user.
- **Forms usable by assistive tech** — every input has a programmatically associated
  label, not just adjacent placeholder text that disappears on focus.

## Honest marketing claims

- **No fabricated reviews or testimonials** — a review/testimonial section needs to be
  real, sourced content, not placeholder or invented text left over from a template.
- **No unverifiable or exaggerated promises** — "guaranteed," "#1," "everyone who tries
  this," or specific outcome numbers need to be either true and checkable, or removed/
  softened to what can actually be backed up.
- **Real business identity disclosed** — a genuine company name/contact/legal entity
  behind the site, not just a form with no accountable party named anywhere.

## Process when this skill fires

1. **Enumerate what the site actually has** first — every page, form, cookie, and
   third-party script/embed — before checking it against anything below. Auditing
   against a generic checklist without listing what's real in this specific site
   produces a report that doesn't match reality.
2. For each policy page, confirm the **content matches the site's actual behavior**,
   not a template's assumptions.
3. Check **consent enforcement at the technical layer** — does declining actually stop
   the script from loading? — not just that a banner is present.
4. Run the accessibility checks against the **live rendered site** (inspect real
   computed styles and DOM, or use a real screen-reader/keyboard pass), not the design
   mockup.
5. **State plainly** what was checked, what was missing, and what was added or fixed —
   name the specific pages/policies/fixes, never just "made it compliant."
