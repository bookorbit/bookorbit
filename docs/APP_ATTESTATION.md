# App Attestation

Most features exclusive to the official BookOrbit iOS and Android apps run on the device. A few need help from the server, and those routes answer only a genuine copy of the official app, verified with Apple App Attest or Android Key Attestation.

**Why.** Cracked copies of the apps circulate online and spoof the official app's identifier. Attestation lets the device's secure hardware prove a request comes from the real, unmodified app, protecting the work that goes into it.

**What is not affected.** The web app, OPDS, KOReader, Kobo sync, API keys, and third-party clients keep working as before. Care was taken that none of them break, and the popular third-party clients have been confirmed to work fully. Only routes the official apps alone use are attested.

**Building exclusive features elsewhere.** Third-party developers are welcome, and the open API is there for them to build on. BookOrbit is open source under the [AGPL-3.0](../LICENSE), so anyone who wants exclusive features in their own app is free to fork BookOrbit, add the server routes those features need, protect them with their own app's attestation, and maintain that fork. The AGPL asks that a fork's source, including its server changes, stays available to the people who use it. Ideas for the open API are welcome as [community discussions](COMMUNITY.md); features exclusive to the official apps stay exclusive to them.

Protecting this work is well within the project's rights, and attestation will stay. Anyone who does not accept that is free to fork BookOrbit or use something else.
