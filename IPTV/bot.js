const { chromium } = require('playwright');
const express = require('express');
const app = express();
app.use(express.json());

app.post('/create-user', async (req, res) => {
    const { username, packageId } = req.body;
    
    // Lanzar navegador (puedes poner headless: false para ver qué hace el bot)
    const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // 1. LOGIN
        await page.goto('http://redworld.pro:2052/login.php');
        await page.fill('input[name="username"]', 'Flashstorechile');
        await page.fill('input[name="password"]', '83@8$##82@2835flash');
        await page.click('button[type="submit"]');

        // 2. IR A CREACIÓN Y LLENAR DATOS
        await page.goto('http://redworld.pro:2052/user_reseller.php');
        await page.fill('#username', username);
        await page.selectOption('#package', packageId);

        // 3. PASO CRÍTICO: Simular el flujo visual para activar créditos
        await page.click('a[href="#review-purchase"]');
        
        // Esperamos a que el JS del panel calcule los créditos (como viste en el HTML)
        await page.waitForTimeout(3000); 

        // 4. CLICK EN EL BOTÓN REAL DE PURCHASE
        // Usamos el selector de clase que vimos en tu código fuente
        await page.click('.purchase');

        // 5. ESPERAR RESULTADO
        await page.waitForTimeout(2000);
        const currentUrl = page.url();

        if (currentUrl.includes('successedit')) {
            res.json({ status: 'success', message: 'Usuario creado', url: currentUrl });
        } else {
            res.status(400).json({ status: 'error', message: 'No se pudo completar la compra' });
        }

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    } finally {
        await browser.close();
    }
});

app.listen(3000, () => console.log('API de Playwright lista en el puerto 3000'));