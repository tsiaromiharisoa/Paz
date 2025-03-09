const axios = require('axios');
const sendMessage = require('../handles/sendMessage'); // Importer la fonction sendMessage

// Fonction pour découper un texte en morceaux de 500 caractères
function splitText(text, maxLength) {
    const parts = [];
    let startIndex = 0;
    while (startIndex < text.length) {
        const endIndex = Math.min(startIndex + maxLength, text.length);
        parts.push(text.slice(startIndex, endIndex));
        startIndex = endIndex;
    }
    return parts;
}

// Fonction pour traduire un texte avec l'API MyMemory
async function translateText(text) {
    const translationApiUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|fr`;
    const response = await axios.get(translationApiUrl);
    return response.data.responseData.translatedText;
}

module.exports = async (senderId, searchQuery) => {
    try {
        // Envoyer un message de confirmation que la recherche a commencé
        await sendMessage(senderId, `Recherche de "${searchQuery}" sur Wikipedia...`);

        // Appeler l'API Wikipedia avec la requête de l'utilisateur
        const apiUrl = `https://nash-rest-api-production.up.railway.app/wikipedia?search=${encodeURIComponent(searchQuery)}`;
        const response = await axios.get(apiUrl);

        // Récupérer les données pertinentes de la réponse de l'API
        const { title, extract, page_url } = response.data;

        // Découper le texte de l'extrait en morceaux de 500 caractères maximum
        const parts = splitText(extract, 500);

        // Traduire chaque morceau en français
        let translatedText = '';
        for (const part of parts) {
            const translatedPart = await translateText(part);
            translatedText += translatedPart; // Combiner les morceaux traduits
        }

        // Formater la réponse avec les informations traduites
        const reply = `*${title}*\n\n${translatedText}\n\nEn savoir plus: ${page_url}`;

        // Attendre 2 secondes avant d'envoyer la réponse
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Envoyer la réponse traduite à l'utilisateur
        await sendMessage(senderId, reply);
    } catch (error) {
        console.error('Erreur lors de l\'appel à l\'API Wikipedia ou MyMemory:', error);

        // Envoyer un message d'erreur à l'utilisateur en cas de problème
        await sendMessage(senderId, "Désolé, une erreur s'est produite lors de la recherche ou de la traduction.");
    }
};

// Ajouter les informations de la commande
module.exports.info = {
    name: "wikipedia",  // Le nom de la commande
    description: "Recherche des informations sur Wikipedia et traduit en français.",  // Description de la commande
    usage: "Envoyez 'wikipedia <recherche>' pour obtenir un résumé de Wikipedia traduit en français."  // Comment utiliser la commande
};
