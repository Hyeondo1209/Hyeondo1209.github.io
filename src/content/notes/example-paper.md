---
title: A lens as a Fourier transformer
date: 2026-10-12
tags: [광학, 과학철학]
type: paper
lang: en
source: J. W. Goodman, Introduction to Fourier Optics, ch. 5
description: A template for paper and textbook notes, with the one equation worth remembering from the chapter.
---

*This is an example note. It shows the layout for paper notes: a one-line summary, the key result, and open questions. Delete `example-paper.md` once you have your own.*

## One line

A thin lens maps the field in its front focal plane to the Fourier transform of that field in its back focal plane.

## Key result

For an object field $U_o(\xi, \eta)$ placed a distance $d$ in front of a lens of focal length $f$, the field in the back focal plane is

$$
\begin{aligned}
U_f(u, v) &= \frac{A}{j \lambda f}
\exp\!\left[ j \frac{k}{2f}\left(1 - \frac{d}{f}\right)(u^2 + v^2) \right] \\
&\quad \times \iint U_o(\xi, \eta) \exp\!\left[ -j \frac{2\pi}{\lambda f}(\xi u + \eta v) \right] d\xi \, d\eta .
\end{aligned}
$$

When $d = f$, the quadratic phase in front of the integral vanishes and the relation is an exact Fourier transform, up to a constant.[^scale]

## Questions

- What breaks first when the paraxial approximation fails?
- How does this connect to designing a learned optical front end, where the lens is one layer of a network?

[^scale]: The spatial frequency at $(u, v)$ is $f_X = u / \lambda f$, so the focal length sets the scale of the transform.
