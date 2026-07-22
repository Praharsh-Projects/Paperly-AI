import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1
  );
}

test("keeps the landing and validation flow usable across device sizes", async ({
  page,
}) => {
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText(/Paperly.*AI-Powered Exam Question/i);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: /Start For Free/i }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByLabel("Question Header Section")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page
    .getByRole("button", { name: /Generate Question Paper/i })
    .click();
  await expect(page.getByText("Question header is required")).toBeVisible();
});
