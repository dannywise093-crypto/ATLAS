# Test Data

The upstream test-data archive is stored with Git LFS, but its referenced LFS object is currently unavailable (GitHub returns 404). Leaving the pointer in this repository prevents Cloudflare Pages from cloning the repository.

The archive is therefore omitted from this application deployment branch. Knowledge-layer integration tests that require the sample PDFs must first restore the archive from a valid upstream copy; the application build does not depend on this optional test fixture.

Expected extracted files when the archive is restored:

- `ijms-22-05262.pdf` - Biomedical research paper (cystic fibrosis)
- `ijms-22-06193.pdf` - Biomedical research paper (cystic fibrosis therapies)
- `multimodal_test.pdf` - PDF with tables and images for multimodal extraction testing
